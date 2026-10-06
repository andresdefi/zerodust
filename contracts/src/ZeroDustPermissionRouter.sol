// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ZeroDustPermissionRouter
 * @author ZeroDust
 * @notice Sweeps a MetaMask smart account's native balance to EXACTLY 0 through an ERC-7715
 *         permission, without the user's private key.
 *
 * How a sweep works:
 *  - The user grants a one-time MetaMask permission ("native-token-allowance") whose delegate is
 *    this contract (MetaMask's payee and redeemer rules also name this contract).
 *  - The user signs a SweepIntent (EIP-712, same type as ZeroDustSweep) with the destination,
 *    route and fee limits.
 *  - A ZeroDust sponsor calls sweep(): this contract redeems the permission through MetaMask's
 *    DelegationManager, which moves the user's whole balance here in one plain transfer, then
 *    settles exactly like ZeroDustSweep: fee reserve up to maxTotalFeeWei, the rest to the
 *    destination or the signed bridge call, deterministic reimbursement with the 150% guardrail.
 *  - The sweep reverts unless the user's balance is exactly 0 afterwards, and this contract
 *    keeps nothing: its balance ends where it started.
 *
 * Trust: only this contract can redeem the permission (it is the delegate), it only redeems
 * inside sweep(), sweep() only runs with a SweepIntent signed by the delegator, and the funds only
 * go where that intent says. The sponsor pays the gas, so the user's balance can reach 0.
 *
 * Immutable: no owner, no upgrade, no admin. Sponsors and bounds are fixed at deployment.
 */
contract ZeroDustPermissionRouter {
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
    error RouterBalanceChanged();
    error GasPriceCapZero();
    error GasPriceCapTooHigh();
    error OverheadTooLow();
    error OverheadTooHigh();
    error ProtocolFeeTooHigh();
    error ExtraFeeTooHigh();
    error SponsorMustBeEOA();
    error TooManySponsors();
    error NoSponsors();
    error InvalidPermission();
    error UnexpectedTransfer();
    error AmountMismatch();

    // ========= Constants =========
    string public constant NAME = "ZeroDust";
    string public constant VERSION = "permission-1";

    uint8 public constant MODE_TRANSFER = 0;
    uint8 public constant MODE_CALL = 1;

    uint256 public constant MAX_SPONSORS = 3;
    uint256 public constant MAX_DEADLINE_WINDOW_SECS = 60;
    uint256 public constant MAX_OVERESTIMATE_NUM = 150;
    uint256 public constant MAX_OVERESTIMATE_DEN = 100;

    /// @notice MetaMask Delegation Framework v1.3.0, deterministic: the same address on every chain
    address public constant DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;

    /// @dev ERC-7579 mode: single call, default exec type
    bytes32 private constant _MODE_SINGLE_DEFAULT = bytes32(0);

    bytes32 private constant _EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 public constant SWEEP_TYPEHASH = keccak256(
        "SweepIntent(uint8 mode,address user,address destination,uint256 destinationChainId,address callTarget,bytes32 routeHash,uint256 minReceive,uint256 maxTotalFeeWei,uint256 overheadGasUnits,uint256 protocolFeeGasUnits,uint256 extraFeeWei,uint256 reimbGasPriceCapWei,uint256 deadline,uint256 nonce)"
    );

    // ========= Immutable configuration =========
    address public immutable SPONSOR_1;
    address public immutable SPONSOR_2;
    address public immutable SPONSOR_3;
    uint256 public immutable SPONSOR_COUNT;

    uint256 public immutable MIN_OVERHEAD_GAS_UNITS;
    uint256 public immutable MAX_OVERHEAD_GAS_UNITS;
    uint256 public immutable MAX_PROTOCOL_FEE_GAS_UNITS;
    uint256 public immutable MAX_EXTRA_FEE_WEI;
    uint256 public immutable MAX_REIMB_GAS_PRICE_CAP_WEI;

    // ========= Storage =========
    /// @notice Next SweepIntent nonce per user
    mapping(address => uint256) public nonces;
    uint256 private _entered;
    /// @dev The only account this contract accepts native tokens from, set only during a redemption
    address private _expectingFrom;

    // ========= Types (MetaMask Delegation Framework) =========
    struct Caveat {
        address enforcer;
        bytes terms;
        bytes args;
    }

    struct Delegation {
        address delegate;
        address delegator;
        bytes32 authority;
        Caveat[] caveats;
        uint256 salt;
        bytes signature;
    }

    struct SweepIntent {
        uint8 mode;
        address user;
        address destination;
        uint256 destinationChainId;
        address callTarget;
        bytes32 routeHash;
        uint256 minReceive;
        uint256 maxTotalFeeWei;
        uint256 overheadGasUnits;
        uint256 protocolFeeGasUnits;
        uint256 extraFeeWei;
        uint256 reimbGasPriceCapWei;
        uint256 deadline;
        uint256 nonce;
    }

    // ========= Events =========
    /// @dev Identical to ZeroDustSweep's, so one decoder reads both (here emitted by this contract)
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

    constructor(
        address[] memory sponsors,
        uint256 minOverheadGasUnits,
        uint256 maxOverheadGasUnits,
        uint256 maxProtocolFeeGasUnits,
        uint256 maxExtraFeeWei,
        uint256 maxReimbGasPriceCapWei
    ) {
        if (sponsors.length == 0) revert NoSponsors();
        if (sponsors.length > MAX_SPONSORS) revert TooManySponsors();
        for (uint256 i = 0; i < sponsors.length; i++) {
            require(sponsors[i] != address(0), "SPONSOR_ZERO");
            if (sponsors[i].code.length != 0) revert SponsorMustBeEOA();
        }
        SPONSOR_COUNT = sponsors.length;
        SPONSOR_1 = sponsors[0];
        SPONSOR_2 = sponsors.length > 1 ? sponsors[1] : address(0);
        SPONSOR_3 = sponsors.length > 2 ? sponsors[2] : address(0);

        require(minOverheadGasUnits <= maxOverheadGasUnits, "MIN>MAX_OVERHEAD");
        require(maxOverheadGasUnits <= 1_000_000, "MAX_OVERHEAD_TOO_HIGH");
        require(maxProtocolFeeGasUnits <= 500_000, "MAX_PROTOCOL_FEE_TOO_HIGH");
        require(maxExtraFeeWei <= 1000 ether, "MAX_EXTRA_FEE_TOO_HIGH");
        require(maxReimbGasPriceCapWei <= 10_000 gwei, "MAX_GAS_CAP_TOO_HIGH");
        MIN_OVERHEAD_GAS_UNITS = minOverheadGasUnits;
        MAX_OVERHEAD_GAS_UNITS = maxOverheadGasUnits;
        MAX_PROTOCOL_FEE_GAS_UNITS = maxProtocolFeeGasUnits;
        MAX_EXTRA_FEE_WEI = maxExtraFeeWei;
        MAX_REIMB_GAS_PRICE_CAP_WEI = maxReimbGasPriceCapWei;
    }

    // ========= Entry point =========

    /**
     * @notice Sweep s.user's whole native balance to exactly 0 through their MetaMask permission.
     * @param s SweepIntent signed by s.user (EIP-712, domain = this contract on this chain)
     * @param userSig 65-byte ECDSA signature by s.user's key
     * @param callData Bridge call (MODE_CALL, must hash to s.routeHash), empty for MODE_TRANSFER
     * @param permissionContext The ERC-7715 permission context: abi.encode(Delegation[]) with one
     *        delegation from s.user to this contract
     */
    function sweep(
        SweepIntent calldata s,
        bytes calldata userSig,
        bytes calldata callData,
        bytes calldata permissionContext
    )
        external
    {
        _onlySponsor();
        if (_entered == 1) revert Reentrancy();
        _entered = 1;

        if (block.timestamp > s.deadline) revert DeadlineExpired();
        if (s.deadline > block.timestamp + MAX_DEADLINE_WINDOW_SECS) revert DeadlineTooFar();
        if (s.nonce != nonces[s.user]) revert NonceMismatch();

        if (s.overheadGasUnits < MIN_OVERHEAD_GAS_UNITS) revert OverheadTooLow();
        if (s.overheadGasUnits > MAX_OVERHEAD_GAS_UNITS) revert OverheadTooHigh();
        if (s.protocolFeeGasUnits > MAX_PROTOCOL_FEE_GAS_UNITS) revert ProtocolFeeTooHigh();
        if (s.extraFeeWei > MAX_EXTRA_FEE_WEI) revert ExtraFeeTooHigh();
        if (s.reimbGasPriceCapWei == 0) revert GasPriceCapZero();
        if (s.reimbGasPriceCapWei > MAX_REIMB_GAS_PRICE_CAP_WEI) revert GasPriceCapTooHigh();

        if (s.mode == MODE_TRANSFER) {
            if (callData.length != 0) revert InvalidMode();
            if (s.routeHash != keccak256("")) revert RouteHashMismatch();
            if (s.destination == address(0)) revert InvalidMode();
        } else if (s.mode == MODE_CALL) {
            if (s.callTarget.code.length == 0) revert TargetNotContract();
            if (keccak256(callData) != s.routeHash) revert RouteHashMismatch();
            if (s.destination == address(0)) revert InvalidDestination();
            if (s.destinationChainId == 0) revert InvalidDestination();
        } else {
            revert InvalidMode();
        }

        _verifySig(s, userSig);
        _checkPermission(permissionContext, s.user);

        // Consume the nonce before any external call
        nonces[s.user] = s.nonce + 1;

        uint256 startGas = gasleft();
        uint256 routerBalanceBefore = address(this).balance;

        // ===== Redeem: the user's whole balance arrives here in one plain transfer =====
        uint256 amount = s.user.balance;
        if (amount == 0) revert InsufficientBalance();
        _redeem(permissionContext, s.user, amount);
        if (s.user.balance != 0) revert NonZeroRemainder();
        if (address(this).balance != routerBalanceBefore + amount) revert AmountMismatch();

        // ===== Settle exactly like ZeroDustSweep =====
        uint256 feeReserve = amount < s.maxTotalFeeWei ? amount : s.maxTotalFeeWei;
        uint256 amountToRoute = amount - feeReserve;
        if (amountToRoute == 0) revert InsufficientBalance();

        if (s.mode == MODE_TRANSFER) {
            if (s.minReceive > 0 && amountToRoute < s.minReceive) revert BelowMinReceive();
            _sendETH(s.destination, amountToRoute);
        } else {
            (bool ok, bytes memory ret) = s.callTarget.call{ value: amountToRoute }(callData);
            if (!ok) revert CallFailed(ret);
        }

        (uint256 reimbWei, uint256 reimbGasPriceWei) = _computeReimbursementWei(
            startGas, s.overheadGasUnits, s.protocolFeeGasUnits, s.extraFeeWei, s.reimbGasPriceCapWei
        );
        if (reimbWei > feeReserve) revert FeeExceedsCap();
        if (reimbWei == 0) revert OverestimateTooHigh();
        unchecked {
            if (feeReserve * MAX_OVERESTIMATE_DEN > reimbWei * MAX_OVERESTIMATE_NUM) revert OverestimateTooHigh();
        }

        // The whole fee reserve goes to the sponsor (reimbursement + bounded unused part)
        _sendETH(msg.sender, feeReserve);

        // This contract keeps nothing from a sweep
        if (address(this).balance != routerBalanceBefore) revert RouterBalanceChanged();

        emit SweepSettled(
            s.mode,
            s.user,
            s.destination,
            s.destinationChainId,
            s.callTarget,
            amountToRoute,
            feeReserve,
            reimbWei,
            feeReserve - reimbWei,
            reimbGasPriceWei,
            s.reimbGasPriceCapWei,
            s.overheadGasUnits,
            s.protocolFeeGasUnits,
            s.extraFeeWei,
            s.nonce
        );
        _entered = 0;
    }

    /// @notice EIP-712 digest a user signs for an intent (for clients and tests)
    function hashIntent(SweepIntent calldata s) external view returns (bytes32) {
        return _hashTypedData(_structHash(s));
    }

    // ========= Permission =========

    /// @dev One delegation, from the intent's user to this contract. Its caveats (amount, expiry,
    ///      payee, redeemer) are enforced by MetaMask's enforcers during redemption.
    function _checkPermission(bytes calldata permissionContext, address user) internal view {
        Delegation[] memory delegations = abi.decode(permissionContext, (Delegation[]));
        if (delegations.length != 1) revert InvalidPermission();
        if (delegations[0].delegator != user) revert InvalidPermission();
        if (delegations[0].delegate != address(this)) revert InvalidPermission();
    }

    function _redeem(bytes calldata permissionContext, address user, uint256 amount) internal {
        bytes[] memory contexts = new bytes[](1);
        contexts[0] = permissionContext;
        bytes32[] memory modes = new bytes32[](1);
        modes[0] = _MODE_SINGLE_DEFAULT;
        bytes[] memory executions = new bytes[](1);
        // ERC-7579 single execution: target (20 bytes) | value (32 bytes) | calldata (empty)
        executions[0] = abi.encodePacked(address(this), amount);

        _expectingFrom = user;
        IDelegationManager(DELEGATION_MANAGER).redeemDelegations(contexts, modes, executions);
        _expectingFrom = address(0);
    }

    /// @notice Accepts native tokens only from the account being redeemed, during its redemption
    receive() external payable {
        if (msg.sender != _expectingFrom || _expectingFrom == address(0)) revert UnexpectedTransfer();
    }

    // ========= Reimbursement =========

    function _computeReimbursementWei(
        uint256 startGas,
        uint256 overheadGasUnits,
        uint256 protocolFeeGasUnits,
        uint256 extraFeeWei,
        uint256 reimbGasPriceCapWei
    )
        internal
        view
        returns (uint256 reimbWei, uint256 reimbGasPriceWei)
    {
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

    function _structHash(SweepIntent calldata s) internal pure returns (bytes32) {
        return keccak256(
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
    }

    function _verifySig(SweepIntent calldata s, bytes calldata sig) internal view {
        address signer = _recoverSigner(_hashTypedData(_structHash(s)), sig);
        if (signer != s.user) revert InvalidSignature();
    }

    function _hashTypedData(bytes32 structHash) internal view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                _EIP712_DOMAIN_TYPEHASH, keccak256(bytes(NAME)), keccak256(bytes(VERSION)), block.chainid, address(this)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

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
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) revert InvalidSignature();
        if (v != 27 && v != 28) revert InvalidSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        return signer;
    }

    // ========= Helpers =========

    function _onlySponsor() internal view {
        if (msg.sender != SPONSOR_1 && msg.sender != SPONSOR_2 && msg.sender != SPONSOR_3) revert NotSponsor();
        if (msg.sender == address(0)) revert NotSponsor();
    }

    function _sendETH(address to, uint256 value) internal {
        (bool ok,) = to.call{ value: value }("");
        require(ok, "ETH_SEND_FAILED");
    }
}

interface IDelegationManager {
    function redeemDelegations(
        bytes[] calldata permissionContexts,
        bytes32[] calldata modes,
        bytes[] calldata executionCallDatas
    )
        external;
}
