// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ZeroDustSweep
 * @author ZeroDust
 * @notice Immutable exit primitive for sweeping native gas to EXACTLY 0 in EIP-7702 execution context.
 *
 * Key properties:
 *  - Sponsor allowlist (1-3 EOAs) set at deploy time for redundancy and key rotation.
 *  - Unified entrypoint:
 *      MODE_TRANSFER: send on-source-chain native value to destination. minReceive enforced on-chain.
 *      MODE_CALL: route by calling callTarget with signed callData (routeHash binding). minReceive is
 *                 informational (enforced by routing provider in calldata).
 *  - Per-intent reimbursement gas price cap (quote-engine set): reimbGasPrice = min(tx.gasprice, reimbGasPriceCapWei).
 *  - Deterministic reimbursement:
 *      reimbWei = (measuredGasUsed + overheadGasUnits + protocolFeeGasUnits) * reimbGasPrice + extraFeeWei
 *  - Overestimate guardrail (50%): feeReserve <= reimbWei * 150%.
 *  - Deadline bounds enforced: must be expired check AND within 60 seconds window.
 *  - Unused reserve goes to sponsor (by design), but bounded by guardrail.
 *  - Enforces exact-zero remainder of origin account context.
 *
 * EIP-7702 assumption:
 *  - address(this) at runtime is the USER EOA (account context).
 *  - nonce and reentrancy guard are stored in the user's EOA storage.
 *
 * SPONSOR MANAGEMENT:
 *  - Sponsors are set at deploy time and cannot be changed.
 *  - To add/remove sponsors, redeploy the contract.
 *  - Start with 1-2 sponsors, expand to 3 as needed (requires redeploy).
 */
contract ZeroDustSweep {
    // ========= Errors =========
    error NotSponsor();
    error Reentrancy();
    error DeadlineExpired();
    error DeadlineTooFar();
    error NonceMismatch();
    error InvalidSignature();
    error FeeExceedsCap();
    error OverestimateTooHigh();
    error InsufficientBalance();
    error BelowMinReceive();
    error TargetNotContract();
    error RouteHashMismatch();
    error InvalidMode();
    error InvalidDestination();
    error CallFailed(bytes revertData);
    error NonZeroRemainder();
    error GasPriceCapZero();
    error GasPriceCapTooHigh();
    error OverheadTooLow();
    error OverheadTooHigh();
    error ProtocolFeeTooHigh();
    error ExtraFeeTooHigh();
    error SponsorMustBeEOA();
    error TooManySponsors();
    error NoSponsors();

    // ========= Constants =========
    string public constant NAME = "ZeroDust";
    string public constant VERSION = "3";

    uint8 public constant MODE_TRANSFER = 0; // send ETH on THIS chain to destination
    uint8 public constant MODE_CALL     = 1; // call callTarget with callData, sending ETH as msg.value

    /// @notice Maximum number of sponsors allowed (for operational simplicity)
    uint256 public constant MAX_SPONSORS = 3;

    /// @notice Enforce short quote windows on-chain to prevent stale quote exploitation
    uint256 public constant MAX_DEADLINE_WINDOW_SECS = 60;

    /// @notice Overestimate guardrail: feeReserve <= reimbWei * 150 / 100 (50% max overestimate)
    uint256 public constant MAX_OVERESTIMATE_NUM = 150;
    uint256 public constant MAX_OVERESTIMATE_DEN = 100;

    // EIP-712
    bytes32 private constant _EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 public constant SWEEP_TYPEHASH = keccak256(
        "SweepIntent(uint8 mode,address user,address destination,uint256 destinationChainId,address callTarget,bytes32 routeHash,uint256 minReceive,uint256 maxTotalFeeWei,uint256 overheadGasUnits,uint256 protocolFeeGasUnits,uint256 extraFeeWei,uint256 reimbGasPriceCapWei,uint256 deadline,uint256 nonce)"
    );

    // ========= Sponsor allowlist (immutable for EIP-7702 compatibility) =========
    // NOTE: Under EIP-7702, storage reads happen on the user's EOA context.
    // Therefore, sponsor addresses MUST be immutable (stored in bytecode) to work correctly.
    address public immutable SPONSOR_1;
    address public immutable SPONSOR_2;
    address public immutable SPONSOR_3;
    uint256 public immutable SPONSOR_COUNT;

    // ========= Global bounds (same parameters across all chains) =========

    /// @notice Minimum overhead to protect sponsor from under-recovery
    /// @dev Covers: calldata costs, tx base cost (21k), pre-measurement execution (~35k)
    uint256 public immutable MIN_OVERHEAD_GAS_UNITS;

    /// @notice Maximum overhead gas units per intent
    uint256 public immutable MAX_OVERHEAD_GAS_UNITS;

    /// @notice Maximum protocol fee gas units per intent
    uint256 public immutable MAX_PROTOCOL_FEE_GAS_UNITS;

    /// @notice Maximum extra fee in wei per intent
    uint256 public immutable MAX_EXTRA_FEE_WEI;

    /// @notice Maximum reimbursement gas price cap per intent
    uint256 public immutable MAX_REIMB_GAS_PRICE_CAP_WEI;

    // ========= User-context storage (lives in user's EOA storage under EIP-7702) =========
    uint256 public nonce;     // monotonic
    uint256 private _entered; // reentrancy guard

    // ========= Events =========

    /**
     * @notice Comprehensive settlement event for analytics and debugging.
     * @dev Emitted on every successful sweep with full fee breakdown.
     */
    event SweepSettled(
        uint8 mode,
        address indexed user,
        address indexed destination,
        uint256 destinationChainId,
        address indexed callTarget,
        uint256 amountRoutedWei,
        uint256 feeReserveWei,
        uint256 reimbWei,
        uint256 unusedWei,
        uint256 reimbGasPriceWei,
        uint256 reimbGasPriceCapWei,
        uint256 overheadGasUnits,
        uint256 protocolFeeGasUnits,
        uint256 extraFeeWei,
        uint256 nonce
    );

    // ========= Struct =========
    struct SweepIntent {
        uint8 mode;                    // 0 transfer, 1 call
        address user;                  // must equal address(this) in EIP-7702 context
        address destination;           // transfer recipient (mode=0); informational for mode=1 (UI/auditability)
        uint256 destinationChainId;    // informational; signed for integrity/UI
        address callTarget;            // mode=1 target contract
        bytes32 routeHash;             // keccak256(callData); mode=0 must be keccak256("")
        uint256 minReceive;            // MODE_TRANSFER: enforced on-chain; MODE_CALL: informational (provider enforces)
        uint256 maxTotalFeeWei;        // cap on fee reserve (sponsor reimbursement envelope)
        uint256 overheadGasUnits;      // per-intent risk margin (MIN <= x <= MAX)
        uint256 protocolFeeGasUnits;   // per-intent protocol margin (<= MAX)
        uint256 extraFeeWei;           // per-intent fixed wei add-on (<= MAX)
        uint256 reimbGasPriceCapWei;   // per-intent reimb gas price cap (<= MAX)
        uint256 deadline;              // must be > block.timestamp AND <= block.timestamp + 60s
        uint256 nonce;                 // must equal current nonce
    }

    // ========= Constructor =========

    /**
     * @notice Deploy ZeroDustSweepV3 with sponsor allowlist and parameter bounds.
     * @dev Sponsors must be EOAs at deploy time. To change sponsors, redeploy.
     * @param sponsors Array of sponsor EOA addresses (1-3 sponsors)
     * @param minOverheadGasUnits Minimum overhead to protect sponsor (e.g., 50000)
     * @param maxOverheadGasUnits Maximum overhead gas units per intent (e.g., 300000)
     * @param maxProtocolFeeGasUnits Maximum protocol fee gas units (e.g., 100000)
     * @param maxExtraFeeWei Maximum extra fee in wei (e.g., 0.0005 ETH)
     * @param maxReimbGasPriceCapWei Maximum gas price cap (e.g., 1000 gwei)
     */
    constructor(
        address[] memory sponsors,
        uint256 minOverheadGasUnits,
        uint256 maxOverheadGasUnits,
        uint256 maxProtocolFeeGasUnits,
        uint256 maxExtraFeeWei,
        uint256 maxReimbGasPriceCapWei
    ) {
        // Sponsor validation
        if (sponsors.length == 0) revert NoSponsors();
        if (sponsors.length > MAX_SPONSORS) revert TooManySponsors();

        // Validate all sponsors are EOAs
        for (uint256 i = 0; i < sponsors.length; i++) {
            address s = sponsors[i];
            require(s != address(0), "SPONSOR_ZERO");
            // Enforce EOA at deploy-time (no code)
            if (s.code.length != 0) revert SponsorMustBeEOA();
        }

        // Store sponsors in immutable variables (bytecode, not storage)
        // This is required for EIP-7702 compatibility
        SPONSOR_COUNT = sponsors.length;
        SPONSOR_1 = sponsors[0];
        SPONSOR_2 = sponsors.length > 1 ? sponsors[1] : address(0);
        SPONSOR_3 = sponsors.length > 2 ? sponsors[2] : address(0);

        // Parameter validation
        require(minOverheadGasUnits <= maxOverheadGasUnits, "MIN>MAX_OVERHEAD");

        // Sanity checks to prevent deploying with absurd values
        require(maxOverheadGasUnits <= 1_000_000, "MAX_OVERHEAD_TOO_HIGH");
        require(maxProtocolFeeGasUnits <= 500_000, "MAX_PROTOCOL_FEE_TOO_HIGH");
        require(maxExtraFeeWei <= 1 ether, "MAX_EXTRA_FEE_TOO_HIGH");
        require(maxReimbGasPriceCapWei <= 10_000 gwei, "MAX_GAS_CAP_TOO_HIGH");

        MIN_OVERHEAD_GAS_UNITS = minOverheadGasUnits;
        MAX_OVERHEAD_GAS_UNITS = maxOverheadGasUnits;
        MAX_PROTOCOL_FEE_GAS_UNITS = maxProtocolFeeGasUnits;
        MAX_EXTRA_FEE_WEI = maxExtraFeeWei;
        MAX_REIMB_GAS_PRICE_CAP_WEI = maxReimbGasPriceCapWei;
    }

    // ========= Entry point =========

    /**
     * @notice Execute a sweep (transfer or call). Origin must end at EXACTLY 0.
     * @dev Only allowlisted sponsors can call. Enforces minReceive for MODE_TRANSFER.
     *      For MODE_CALL, minReceive is informational (enforced by routing provider in calldata).
     * @param s Sweep intent signed by the user (EIP-712)
     * @param userSig Signature over intent
     * @param callData External call data (only used in MODE_CALL, empty for MODE_TRANSFER)
     */
    function sweep(SweepIntent calldata s, bytes calldata userSig, bytes calldata callData) external {
        _onlySponsor();
        _nonReentrant();

        // ===== Deadline checks =====
        if (block.timestamp > s.deadline) revert DeadlineExpired();
        // Enforce short quote window to prevent stale quote exploitation during gas spikes
        if (s.deadline > block.timestamp + MAX_DEADLINE_WINDOW_SECS) revert DeadlineTooFar();

        // ===== User context binding =====
        if (s.user != address(this)) revert InvalidSignature(); // EIP-7702 user context
        if (s.nonce != nonce) revert NonceMismatch();

        // ===== Parameter bounds =====
        if (s.overheadGasUnits < MIN_OVERHEAD_GAS_UNITS) revert OverheadTooLow();
        if (s.overheadGasUnits > MAX_OVERHEAD_GAS_UNITS) revert OverheadTooHigh();
        if (s.protocolFeeGasUnits > MAX_PROTOCOL_FEE_GAS_UNITS) revert ProtocolFeeTooHigh();
        if (s.extraFeeWei > MAX_EXTRA_FEE_WEI) revert ExtraFeeTooHigh();
        if (s.reimbGasPriceCapWei == 0) revert GasPriceCapZero();
        if (s.reimbGasPriceCapWei > MAX_REIMB_GAS_PRICE_CAP_WEI) revert GasPriceCapTooHigh();

        // ===== Mode-specific validation =====
        if (s.mode == MODE_TRANSFER) {
            if (callData.length != 0) revert InvalidMode();
            if (s.routeHash != keccak256("")) revert RouteHashMismatch();
            if (s.destination == address(0)) revert InvalidMode();
        } else if (s.mode == MODE_CALL) {
            if (s.callTarget.code.length == 0) revert TargetNotContract();
            if (keccak256(callData) != s.routeHash) revert RouteHashMismatch();
            // Validate destination fields for UI/auditability integrity (prevents garbage intents)
            if (s.destination == address(0)) revert InvalidDestination();
            if (s.destinationChainId == 0) revert InvalidDestination();
        } else {
            revert InvalidMode();
        }

        // ===== Verify signature after cheap rejects =====
        _verifySig(s, userSig);

        // Consume nonce early (prevents replay even if downstream reverts)
        nonce = nonce + 1;

        uint256 startGas = gasleft();
        uint256 startBal = address(this).balance;

        // Reserve up to maxTotalFeeWei; remainder is "user funds to route"
        uint256 feeReserve = startBal < s.maxTotalFeeWei ? startBal : s.maxTotalFeeWei;
        uint256 amountToRoute = startBal - feeReserve;
        if (amountToRoute == 0) revert InsufficientBalance();

        // ===== MODE_TRANSFER: enforce minReceive on-chain =====
        // For MODE_CALL, minReceive is enforced by the routing provider (Gas.zip/Jumper/Stargate)
        // embedded in the calldata; this contract only binds routeHash.
        if (s.mode == MODE_TRANSFER && s.minReceive > 0) {
            if (amountToRoute < s.minReceive) revert BelowMinReceive();
        }

        // ===== Execute routing =====
        if (s.mode == MODE_TRANSFER) {
            _sendETH(s.destination, amountToRoute);
        } else {
            (bool ok, bytes memory ret) = s.callTarget.call{value: amountToRoute}(callData);
            if (!ok) revert CallFailed(ret);
        }

        // ===== Compute reimbursement deterministically =====
        (uint256 reimbWei, uint256 reimbGasPriceWei) = _computeReimbursementWei(
            startGas,
            s.overheadGasUnits,
            s.protocolFeeGasUnits,
            s.extraFeeWei,
            s.reimbGasPriceCapWei
        );

        if (reimbWei > feeReserve) revert FeeExceedsCap();

        // ===== Overestimate guardrail (50%) =====
        // feeReserve must be within 150% of reimbWei (prevents padded caps).
        // If reimbWei == 0 (should be impossible due to intrinsic costs), treat as overestimate.
        if (reimbWei == 0) revert OverestimateTooHigh();
        // Formula: feeReserve * 100 <= reimbWei * 150
        unchecked {
            if (feeReserve * MAX_OVERESTIMATE_DEN > reimbWei * MAX_OVERESTIMATE_NUM) {
                revert OverestimateTooHigh();
            }
        }

        // ===== Pay sponsor =====
        if (reimbWei > 0) _sendETH(msg.sender, reimbWei);

        // Unused reserve ALWAYS to sponsor (bounded by overestimate guardrail)
        uint256 unusedWei = feeReserve - reimbWei;
        if (unusedWei > 0) _sendETH(msg.sender, unusedWei);

        // ===== Enforce exact-zero remainder =====
        if (address(this).balance != 0) revert NonZeroRemainder();

        // ===== Emit comprehensive event =====
        emit SweepSettled(
            s.mode,
            s.user,
            s.destination,
            s.destinationChainId,
            s.callTarget,
            amountToRoute,
            feeReserve,
            reimbWei,
            unusedWei,
            reimbGasPriceWei,
            s.reimbGasPriceCapWei,
            s.overheadGasUnits,
            s.protocolFeeGasUnits,
            s.extraFeeWei,
            s.nonce
        );

        _exitNonReentrant();
    }

    // ========= Reimbursement computation =========

    function _computeReimbursementWei(
        uint256 startGas,
        uint256 overheadGasUnits,
        uint256 protocolFeeGasUnits,
        uint256 extraFeeWei,
        uint256 reimbGasPriceCapWei
    ) internal view returns (uint256 reimbWei, uint256 reimbGasPriceWei) {
        uint256 gasUsedMeasured = startGas - gasleft();
        uint256 totalGasUnits = gasUsedMeasured + overheadGasUnits + protocolFeeGasUnits;

        uint256 gp = tx.gasprice;
        if (gp > reimbGasPriceCapWei) gp = reimbGasPriceCapWei;

        unchecked {
            reimbWei = (totalGasUnits * gp) + extraFeeWei;
        }
        reimbGasPriceWei = gp;
    }

    // ========= EIP-712 =========

    function _verifySig(SweepIntent calldata s, bytes calldata sig) internal view {
        bytes32 structHash = keccak256(
            abi.encode(
                SWEEP_TYPEHASH,
                s.mode,
                s.user,
                s.destination,
                s.destinationChainId,
                s.callTarget,
                s.routeHash,
                s.minReceive,
                s.maxTotalFeeWei,
                s.overheadGasUnits,
                s.protocolFeeGasUnits,
                s.extraFeeWei,
                s.reimbGasPriceCapWei,
                s.deadline,
                s.nonce
            )
        );

        address signer = _recoverSigner(_hashTypedData(structHash), sig);
        if (signer != s.user) revert InvalidSignature();
    }

    /**
     * @dev Domain separator binds to address(this).
     * Under EIP-7702, address(this) is the user EOA at runtime, preventing cross-user replay.
     */
    function _hashTypedData(bytes32 structHash) internal view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                _EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                block.chainid,
                address(this)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    // ========= Sponsor gating / reentrancy =========

    function _onlySponsor() internal view {
        // Check against immutable sponsor addresses (stored in bytecode)
        // This works correctly under EIP-7702 because immutables are in bytecode, not storage
        if (msg.sender != SPONSOR_1 && msg.sender != SPONSOR_2 && msg.sender != SPONSOR_3) {
            revert NotSponsor();
        }
    }

    /// @notice Check if an address is a sponsor (view function for off-chain use)
    function isSponsor(address addr) external view returns (bool) {
        return addr == SPONSOR_1 || addr == SPONSOR_2 || addr == SPONSOR_3;
    }

    function _nonReentrant() internal {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
    }

    function _exitNonReentrant() internal {
        _entered = 0;
    }

    // ========= ETH send =========

    /**
     * @dev Send ETH to an address. No gas limit to support smart wallets/contracts.
     *      Reentrancy is prevented by the _entered guard at function entry.
     */
    function _sendETH(address to, uint256 value) internal {
        (bool ok, ) = to.call{value: value}("");
        require(ok, "ETH_SEND_FAILED");
    }

    // ========= ECDSA recover =========

    function _recoverSigner(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }

        // lower-S check (EIP-2)
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) {
            revert InvalidSignature();
        }
        if (v != 27 && v != 28) revert InvalidSignature();

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        return signer;
    }
}
