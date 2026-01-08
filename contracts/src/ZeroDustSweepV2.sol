// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IZeroDustAdapter} from "./interfaces/IZeroDustAdapter.sol";

/**
 * @title ZeroDustSweepV2
 * @author ZeroDust
 * @notice Intent-based exit system for sweeping native gas tokens to exactly zero
 * @dev Uses EIP-7702 sponsored execution - this contract runs AS the user's EOA
 *
 * CRITICAL EIP-7702 CONTEXT:
 * - Under EIP-7702, address(this) IS the user's EOA address
 * - Storage reads/writes go to the user's EOA storage
 * - Immutables (DOMAIN_SEPARATOR, adapters) come from implementation bytecode
 * - The contract executes in the user's account context with access to their balance
 *
 * POST-CONDITION (core promise - ENFORCED):
 * After execution, the source address has exactly 0 native token (no wei),
 * and the user's value lands at the chosen destination under agreed constraints.
 * The contract REVERTS if any balance remains after execution.
 *
 * Supported sweep cases:
 * 1. Cross-chain, same address: (chain A, addr U) → (chain B, addr U), balanceA(U) = 0
 * 2. Cross-chain, different address: (chain A, addr U) → (chain B, addr V), balanceA(U) = 0
 * 3. Same-chain, different address: (chain A, addr U) → (chain A, addr V), balanceA(U) = 0
 *
 * Security properties:
 * - No admin functions
 * - No upgradability
 * - Immutable adapter allowlist (new adapters require new contract version)
 * - Semantic parameters (recipient, chainId, minReceive) are signed, not arbitrary calldata
 * - ERC-7201 namespaced storage to prevent slot collisions with other EIP-7702 apps
 */
contract ZeroDustSweepV2 {
    // ============ Constants ============

    string public constant NAME = "ZeroDust";
    string public constant VERSION = "2";

    /// @notice EIP-712 typehash for same-chain sweep
    bytes32 public constant SAME_CHAIN_SWEEP_TYPEHASH = keccak256(
        "SameChainSweep(address user,address destination,address relayer,uint256 maxRelayerFee,uint256 deadline,uint256 nonce)"
    );

    /// @notice EIP-712 typehash for cross-chain sweep
    /// @dev minReceive is the user's on-chain protection for bridge fees/slippage
    /// @dev refundRecipient is explicitly signed to prevent front-running of refunds
    bytes32 public constant CROSS_CHAIN_SWEEP_TYPEHASH = keccak256(
        "CrossChainSweep(address user,uint256 destinationChainId,address destination,address relayer,address adapter,address refundRecipient,uint256 maxRelayerFee,uint256 minReceive,uint256 deadline,uint256 nonce)"
    );

    /// @notice Maximum value for s in ECDSA signature (secp256k1n / 2) per EIP-2
    uint256 private constant MAX_S = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    /// @notice ERC-7201 namespaced storage slot for nonce
    /// @dev keccak256(abi.encode(uint256(keccak256("zerodust.sweep.v2.nonce")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant NONCE_SLOT = 0x5a269d184a7f73b99fee939e0587a45c94cee2c0c7fc0e0d59c12e3b8e4d5d00;

    // ============ Immutables (stored in bytecode, not storage) ============

    /// @notice Initial chain ID at deployment (for domain separator recomputation on forks)
    uint256 public immutable INITIAL_CHAIN_ID;

    /// @notice Initial domain separator at deployment
    bytes32 public immutable INITIAL_DOMAIN_SEPARATOR;

    /// @notice Allowed adapters (stored in bytecode - new adapters require new contract version)
    address public immutable adapter0;
    address public immutable adapter1;
    address public immutable adapter2;
    address public immutable adapter3;
    uint8 public immutable adapterCount;

    // ============ Events ============

    /// @notice Emitted when a same-chain sweep is executed
    event SameChainSweepExecuted(
        address indexed user,
        address indexed destination,
        uint256 amountSent,
        uint256 relayerFee,
        address relayer,
        uint256 nonce
    );

    /// @notice Emitted when a cross-chain sweep is executed
    event CrossChainSweepExecuted(
        address indexed user,
        uint256 indexed destinationChainId,
        address destination,
        address adapter,
        address refundRecipient,
        uint256 amountBridged,
        uint256 relayerFee,
        uint256 minReceive,
        address relayer,
        uint256 nonce
    );

    // ============ Errors ============

    /// @notice Thrown when auth.user != address(this) - not executing in correct EIP-7702 context
    error InvalidExecutionContext();

    /// @notice Thrown when signature is invalid, malformed, or has high-s value
    error InvalidSignature();

    /// @notice Thrown when the authorization deadline has passed
    error DeadlineExpired();

    /// @notice Thrown when the nonce doesn't match expected next nonce
    error InvalidNonce();

    /// @notice Thrown when account balance is zero
    error ZeroBalance();

    /// @notice Thrown when destination address is invalid (zero or self)
    error InvalidDestination();

    /// @notice Thrown when adapter is not in the allowlist
    error InvalidAdapter();

    /// @notice Thrown when msg.sender is not the authorized relayer
    error UnauthorizedRelayer();

    /// @notice Thrown when native token transfer fails
    error TransferFailed();

    /// @notice Thrown when adapter call fails
    error AdapterCallFailed();

    /// @notice Thrown when balance is not exactly zero after sweep (core promise violated)
    error NonZeroRemainder();

    /// @notice Thrown when refund recipient is zero address
    error InvalidRefundRecipient();

    /// @notice Thrown when cross-chain sweep has no pinned relayer (address(0))
    error RelayerRequired();

    /// @notice Thrown when too many adapters provided to constructor (max 4)
    error TooManyAdapters();

    /// @notice Thrown when zero address adapter provided to constructor
    error ZeroAdapter();

    /// @notice Thrown when duplicate adapter provided to constructor
    error DuplicateAdapter();

    // ============ Structs ============

    /**
     * @notice Same-chain sweep intent
     * @dev Use case 3: (chain A, addr U) → (chain A, addr V)
     * @param user Must equal address(this) under EIP-7702 - the account being swept
     * @param destination Recipient address on same chain (must not be user/zero)
     * @param relayer Authorized relayer address (address(0) = anyone can execute)
     * @param maxRelayerFee Maximum fee relayer can take from balance
     * @param deadline Unix timestamp after which authorization expires
     * @param nonce Must match nextNonce in user's storage
     */
    struct SameChainSweep {
        address user;
        address destination;
        address relayer;
        uint256 maxRelayerFee;
        uint256 deadline;
        uint256 nonce;
    }

    /**
     * @notice Cross-chain sweep intent
     * @dev Use cases 1 & 2: (chain A, addr U) → (chain B, addr U/V)
     * @param user Must equal address(this) under EIP-7702 - the account being swept
     * @param destinationChainId Target chain ID
     * @param destination Recipient address on destination chain
     * @param relayer REQUIRED: Authorized relayer address (must not be address(0) for cross-chain)
     * @param adapter Bridge adapter address (must be in allowlist)
     * @param refundRecipient MUST equal relayer - address to receive any bridge refunds
     *        (protocol enforces refundRecipient == relayer for simplicity)
     * @param maxRelayerFee Maximum fee for relayer
     * @param minReceive Minimum amount to receive on destination - this is the user's
     *        on-chain protection against bridge fees/slippage (0 = any, not recommended)
     * @param deadline Unix timestamp after which authorization expires
     * @param nonce Must match nextNonce in user's storage
     */
    struct CrossChainSweep {
        address user;
        uint256 destinationChainId;
        address destination;
        address relayer;
        address adapter;
        address refundRecipient;
        uint256 maxRelayerFee;
        uint256 minReceive;
        uint256 deadline;
        uint256 nonce;
    }

    // ============ Constructor ============

    /**
     * @notice Deploy with immutable adapter allowlist
     * @dev Adapters are stored in bytecode - new adapters require new contract version
     * @param _adapters Array of allowed bridge adapter addresses (max 4, no duplicates, no zero)
     */
    constructor(address[] memory _adapters) {
        if (_adapters.length > 4) revert TooManyAdapters();

        // Check for zero addresses and duplicates (O(n²) with max 4 is fine)
        for (uint256 i = 0; i < _adapters.length; i++) {
            if (_adapters[i] == address(0)) revert ZeroAdapter();
            for (uint256 j = i + 1; j < _adapters.length; j++) {
                if (_adapters[i] == _adapters[j]) revert DuplicateAdapter();
            }
        }

        INITIAL_CHAIN_ID = block.chainid;
        INITIAL_DOMAIN_SEPARATOR = _computeDomainSeparator();

        // Store adapters as immutables (in bytecode, not storage)
        adapterCount = uint8(_adapters.length);
        adapter0 = _adapters.length > 0 ? _adapters[0] : address(0);
        adapter1 = _adapters.length > 1 ? _adapters[1] : address(0);
        adapter2 = _adapters.length > 2 ? _adapters[2] : address(0);
        adapter3 = _adapters.length > 3 ? _adapters[3] : address(0);
    }

    // ============ External Functions ============

    /**
     * @notice Execute a same-chain sweep (sweep to different address on same chain)
     * @dev Called via EIP-7702 delegation - this contract runs AS the user's EOA
     *
     * Flow:
     * 1. Verify execution context (auth.user == address(this))
     * 2. Verify deadline, nonce, destination, relayer authorization
     * 3. Verify EIP-712 signature with low-s check
     * 4. Increment nonce (using namespaced storage)
     * 5. Transfer fee to relayer, remainder to destination
     * 6. ENFORCE zero balance post-condition
     *
     * @param sweep The sweep intent signed by the user
     * @param signature EIP-712 signature (65 bytes, must have low-s)
     */
    function executeSameChainSweep(
        SameChainSweep calldata sweep,
        bytes calldata signature
    ) external {
        // ============ Critical EIP-7702 Context Check ============
        // Under EIP-7702, address(this) IS the user's EOA
        // This prevents: (1) calling implementation directly, (2) using wrong user's signature
        if (sweep.user != address(this)) {
            revert InvalidExecutionContext();
        }

        // ============ Checks ============
        if (block.timestamp > sweep.deadline) {
            revert DeadlineExpired();
        }

        // Monotonic nonce from namespaced storage
        uint256 currentNonce = _getNextNonce();
        if (sweep.nonce != currentNonce) {
            revert InvalidNonce();
        }

        // Destination must be valid and not self (self-transfer is a no-op that breaks the promise)
        if (sweep.destination == address(0) || sweep.destination == address(this)) {
            revert InvalidDestination();
        }

        // Relayer authorization (address(0) = permissionless execution)
        if (sweep.relayer != address(0) && msg.sender != sweep.relayer) {
            revert UnauthorizedRelayer();
        }

        // Verify signature with low-s malleability check
        _verifySignature(
            keccak256(
                abi.encode(
                    SAME_CHAIN_SWEEP_TYPEHASH,
                    sweep.user,
                    sweep.destination,
                    sweep.relayer,
                    sweep.maxRelayerFee,
                    sweep.deadline,
                    sweep.nonce
                )
            ),
            signature,
            sweep.user
        );

        // Get balance - this IS the user's balance under EIP-7702
        uint256 balance = address(this).balance;
        if (balance == 0) {
            revert ZeroBalance();
        }

        // ============ Effects ============
        // Increment nonce before external calls (CEI pattern)
        _setNextNonce(currentNonce + 1);

        // Calculate fee (capped at maxRelayerFee and balance)
        uint256 relayerFee = balance > sweep.maxRelayerFee ? sweep.maxRelayerFee : balance;
        uint256 amountToDestination = balance - relayerFee;

        // ============ Interactions ============

        // Pay fee to executing relayer
        if (relayerFee > 0) {
            (bool feeSuccess,) = payable(msg.sender).call{value: relayerFee}("");
            if (!feeSuccess) revert TransferFailed();
        }

        // Send remainder to destination
        if (amountToDestination > 0) {
            (bool destSuccess,) = payable(sweep.destination).call{value: amountToDestination}("");
            if (!destSuccess) revert TransferFailed();
        }

        // ============ ENFORCE CORE PROMISE: Zero Balance ============
        // If destination sent ETH back or any other edge case, revert
        if (address(this).balance != 0) {
            revert NonZeroRemainder();
        }

        emit SameChainSweepExecuted(
            sweep.user,
            sweep.destination,
            amountToDestination,
            relayerFee,
            msg.sender,
            sweep.nonce
        );
    }

    /**
     * @notice Execute a cross-chain sweep via bridge adapter
     * @dev Called via EIP-7702 delegation - routes through approved adapter
     *
     * Flow:
     * 1. Verify execution context (auth.user == address(this))
     * 2. Verify deadline, nonce, destination, refundRecipient, adapter allowlist
     * 3. Verify relayer is pinned (address(0) not allowed for cross-chain)
     * 4. Verify EIP-712 signature with low-s check
     * 5. Increment nonce (using namespaced storage)
     * 6. Transfer relayer fee
     * 7. Call adapter with semantic parameters + routing data
     * 8. ENFORCE zero balance post-condition
     *
     * Security: User signs SEMANTIC parameters (destinationChainId, recipient, minReceive, refundRecipient).
     * The adapter receives these signed parameters and must honor them.
     * adapterData contains bridge-specific routing info computed by relayer.
     *
     * IMPORTANT: Cross-chain sweeps require a pinned relayer (sweep.relayer != address(0)).
     * This provides stronger guarantees for wallet-provider integrations.
     *
     * IMPORTANT: Adapters MUST NOT refund surplus to address(this).
     * Refunds must go to sweep.refundRecipient (signed by user).
     *
     * @param sweep The sweep intent signed by the user
     * @param signature EIP-712 signature (65 bytes, must have low-s)
     * @param adapterData Bridge-specific routing data (quote response, route info)
     */
    function executeCrossChainSweep(
        CrossChainSweep calldata sweep,
        bytes calldata signature,
        bytes calldata adapterData
    ) external {
        // ============ Critical EIP-7702 Context Check ============
        if (sweep.user != address(this)) {
            revert InvalidExecutionContext();
        }

        // ============ Checks ============
        if (block.timestamp > sweep.deadline) {
            revert DeadlineExpired();
        }

        uint256 currentNonce = _getNextNonce();
        if (sweep.nonce != currentNonce) {
            revert InvalidNonce();
        }

        if (sweep.destination == address(0)) {
            revert InvalidDestination();
        }

        // Refund recipient must equal relayer (simplifies adapter implementations)
        // Since cross-chain requires pinned relayer, refunds always go to the executor
        // This is a protocol guarantee - users are protected by minReceive on destination
        if (sweep.refundRecipient == address(0) || sweep.refundRecipient != sweep.relayer) {
            revert InvalidRefundRecipient();
        }

        // Adapter must be in immutable allowlist
        if (!_isAllowedAdapter(sweep.adapter)) {
            revert InvalidAdapter();
        }

        // Cross-chain requires a pinned relayer (no permissionless execution)
        // This provides stronger guarantees for wallet-provider integrations
        // Permissionless cross-chain can be added in a future version if needed
        if (sweep.relayer == address(0)) {
            revert RelayerRequired();
        }

        // Relayer authorization - verify msg.sender is the pinned relayer
        if (msg.sender != sweep.relayer) {
            revert UnauthorizedRelayer();
        }

        // Verify signature with low-s malleability check
        _verifySignature(
            keccak256(
                abi.encode(
                    CROSS_CHAIN_SWEEP_TYPEHASH,
                    sweep.user,
                    sweep.destinationChainId,
                    sweep.destination,
                    sweep.relayer,
                    sweep.adapter,
                    sweep.refundRecipient,
                    sweep.maxRelayerFee,
                    sweep.minReceive,
                    sweep.deadline,
                    sweep.nonce
                )
            ),
            signature,
            sweep.user
        );

        // Get balance
        uint256 balance = address(this).balance;
        if (balance == 0) {
            revert ZeroBalance();
        }

        // ============ Effects ============
        _setNextNonce(currentNonce + 1);

        // Calculate amounts (separate relayer fee and bridge amount)
        uint256 relayerFee = balance > sweep.maxRelayerFee ? sweep.maxRelayerFee : balance;
        uint256 amountToBridge = balance - relayerFee;

        // ============ Interactions ============

        // Pay fee to relayer first (before adapter call)
        if (relayerFee > 0) {
            (bool feeSuccess,) = payable(msg.sender).call{value: relayerFee}("");
            if (!feeSuccess) revert TransferFailed();
        }

        // Call adapter with semantic parameters via typed interface
        // Adapter receives: signed params (chainId, recipient, minReceive, refundRecipient) + routing data
        // Adapter MUST honor the signed semantic parameters
        // Adapter MUST NOT refund to address(this) - would break zero balance promise
        // refundRecipient is explicitly signed by user - prevents front-running of refunds
        if (amountToBridge > 0) {
            try IZeroDustAdapter(sweep.adapter).executeNativeBridge{value: amountToBridge}(
                sweep.destinationChainId,
                sweep.destination,
                sweep.minReceive,
                sweep.refundRecipient, // signed by user - critical for zero balance guarantee
                adapterData
            ) {} catch {
                revert AdapterCallFailed();
            }
        }

        // ============ ENFORCE CORE PROMISE: Zero Balance ============
        // If adapter refunded ETH or any other edge case, revert
        if (address(this).balance != 0) {
            revert NonZeroRemainder();
        }

        emit CrossChainSweepExecuted(
            sweep.user,
            sweep.destinationChainId,
            sweep.destination,
            sweep.adapter,
            sweep.refundRecipient,
            amountToBridge,
            relayerFee,
            sweep.minReceive,
            msg.sender,
            sweep.nonce
        );
    }

    // ============ View Functions ============

    /**
     * @notice Get the next nonce for this account
     * @dev Reads from ERC-7201 namespaced storage slot
     * @dev Under EIP-7702: reads from user's EOA storage
     * @return The next expected nonce value
     */
    function nextNonce() external view returns (uint256) {
        return _getNextNonce();
    }

    /**
     * @notice Get the current domain separator
     * @dev Returns cached value if chain ID unchanged, recomputes on fork
     * @return The EIP-712 domain separator
     */
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparator();
    }

    /**
     * @notice Check if an adapter is in the allowlist
     * @dev Reads from immutables (bytecode), works correctly under EIP-7702
     * @param adapter Address to check
     * @return True if adapter is allowed
     */
    function isAllowedAdapter(address adapter) external view returns (bool) {
        return _isAllowedAdapter(adapter);
    }

    /**
     * @notice Get all allowed adapters
     * @return Array of allowed adapter addresses
     */
    function getAllowedAdapters() external view returns (address[] memory) {
        address[] memory adapters = new address[](adapterCount);
        if (adapterCount > 0) adapters[0] = adapter0;
        if (adapterCount > 1) adapters[1] = adapter1;
        if (adapterCount > 2) adapters[2] = adapter2;
        if (adapterCount > 3) adapters[3] = adapter3;
        return adapters;
    }

    // ============ Internal Functions ============

    /**
     * @notice Get next nonce from ERC-7201 namespaced storage
     * @dev Prevents slot collisions with other EIP-7702 delegated apps
     */
    function _getNextNonce() internal view returns (uint256 n) {
        bytes32 slot = NONCE_SLOT;
        assembly {
            n := sload(slot)
        }
    }

    /**
     * @notice Set next nonce in ERC-7201 namespaced storage
     * @dev Prevents slot collisions with other EIP-7702 delegated apps
     */
    function _setNextNonce(uint256 n) internal {
        bytes32 slot = NONCE_SLOT;
        assembly {
            sstore(slot, n)
        }
    }

    /**
     * @notice Get domain separator, recomputing if chain ID changed (fork protection)
     * @dev Uses cached value if chain ID matches deployment, otherwise recomputes
     */
    function _domainSeparator() internal view returns (bytes32) {
        if (block.chainid == INITIAL_CHAIN_ID) {
            return INITIAL_DOMAIN_SEPARATOR;
        }
        return _computeDomainSeparator();
    }

    /**
     * @notice Compute EIP-712 domain separator
     * @dev Used at deployment and for recomputation on forks
     */
    function _computeDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    /**
     * @notice Check if adapter is in immutable allowlist
     * @dev Immutables stored in bytecode, not storage - works under EIP-7702
     */
    function _isAllowedAdapter(address adapter) internal view returns (bool) {
        if (adapter == address(0)) return false;
        if (adapter == adapter0) return true;
        if (adapterCount > 1 && adapter == adapter1) return true;
        if (adapterCount > 2 && adapter == adapter2) return true;
        if (adapterCount > 3 && adapter == adapter3) return true;
        return false;
    }

    /**
     * @notice Verify EIP-712 signature with low-s malleability check
     * @param structHash The EIP-712 struct hash
     * @param signature The signature bytes (must be 65 bytes)
     * @param expectedSigner The expected signer address
     */
    function _verifySignature(
        bytes32 structHash,
        bytes calldata signature,
        address expectedSigner
    ) internal view {
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _domainSeparator(), structHash)
        );

        address signer = _recoverSigner(digest, signature);
        if (signer != expectedSigner) {
            revert InvalidSignature();
        }
    }

    /**
     * @notice Recover signer with strict validation
     * @dev Enforces:
     *      - Exactly 65 bytes
     *      - Low-s value per EIP-2 (prevents malleability)
     *      - Normalized v value (accepts 0/1, converts to 27/28)
     *      - Non-zero recovered address
     * @param digest The message digest that was signed
     * @param signature The signature bytes
     * @return The recovered signer address
     */
    function _recoverSigner(
        bytes32 digest,
        bytes calldata signature
    ) internal pure returns (address) {
        // Only support 65-byte signatures (no EIP-2098 compact)
        // This simplifies validation and is standard for EIP-712
        if (signature.length != 65) {
            revert InvalidSignature();
        }

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        // Reject zero values for r and s (micro-hardening)
        if (r == 0 || s == 0) {
            revert InvalidSignature();
        }

        // Enforce low-s per EIP-2 to prevent signature malleability
        // High-s signatures can be converted to low-s, breaking replay assumptions
        if (uint256(s) > MAX_S) {
            revert InvalidSignature();
        }

        // Normalize v value: many toolchains produce v as 0/1 instead of 27/28
        if (v < 27) {
            v += 27;
        }

        // After normalization, v must be 27 or 28
        if (v != 27 && v != 28) {
            revert InvalidSignature();
        }

        // Recover signer
        address recovered = ecrecover(digest, v, r, s);

        // ecrecover returns address(0) on failure
        if (recovered == address(0)) {
            revert InvalidSignature();
        }

        return recovered;
    }

    // ============ Receive ============

    /// @notice Allow receiving native tokens
    /// @dev Required for EIP-7702 context where this code runs in user's EOA
    receive() external payable {}
}
