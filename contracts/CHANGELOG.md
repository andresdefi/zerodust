# ZeroDust Contracts Changelog

## Version 2.0.0 (January 2026)

This version introduces a complete redesign of the smart contract architecture based on security advisor feedback. The changes address critical vulnerabilities and establish a robust foundation for cross-chain sweeps.

---

## Summary of Changes

| Component | Status | Description |
|-----------|--------|-------------|
| `ZeroDustSweepV2.sol` | **New** | Complete rewrite with 7 rounds of security improvements |
| `IZeroDustAdapter.sol` | **New** | Interface for bridge adapters |
| `BungeeAdapter.sol` | **New** | First bridge adapter (Bungee Auto) |
| `foundry.toml` | **Modified** | Enabled `via_ir=true` for stack optimization |

---

## ZeroDustSweepV2.sol

### Why V2 Was Created

The original `ZeroDustSweep.sol` (V1) had several critical issues identified during security review:

#### Issue 1: Missing Execution Context Binding
**V1 Problem:** The contract did not verify that `auth.user == address(this)`.

**Risk:** Under EIP-7702, `address(this)` IS the user's EOA. Without this check:
- Someone could call the implementation contract directly
- Someone could use User A's signature while executing on User B's delegated EOA

**V2 Fix:**
```solidity
if (sweep.user != address(this)) {
    revert InvalidExecutionContext();
}
```

#### Issue 2: Missing Low-S Signature Check
**V1 Problem:** No malleability protection for ECDSA signatures.

**Risk:** High-s signatures can be mathematically converted to low-s equivalents, allowing signature "forging" that might bypass replay protections or cause unexpected behavior.

**V2 Fix:**
```solidity
uint256 private constant MAX_S = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

// In _recoverSigner:
if (uint256(s) > MAX_S) {
    revert InvalidSignature();
}
```

#### Issue 3: Storage Slot Collision Risk (ERC-7201)
**V1 Problem:** Used standard storage slots for nonces.

**Risk:** Under EIP-7702, multiple apps may delegate to different contracts from the same EOA. Standard storage slots could collide, allowing one app to corrupt another's nonces.

**V2 Fix:** ERC-7201 namespaced storage:
```solidity
// Computed via: keccak256(abi.encode(uint256(keccak256("zerodust.sweep.v2.nonce")) - 1)) & ~bytes32(uint256(0xff))
bytes32 private constant NONCE_SLOT = 0x5a269d184a7f73b99fee939e0587a45c94cee2c0c7fc0e0d59c12e3b8e4d5d00;

function _getNextNonce() internal view returns (uint256 n) {
    bytes32 slot = NONCE_SLOT;
    assembly { n := sload(slot) }
}
```

#### Issue 4: Zero Balance Post-Condition Not Enforced
**V1 Problem:** Did not verify balance was exactly zero after execution.

**Risk:** The core promise of ZeroDust is "sweep to exactly zero." Without enforcement:
- Reentrancy or callback attacks could leave funds
- Adapter refunds could break the promise
- Edge cases could leave dust

**V2 Fix:**
```solidity
// After all transfers:
if (address(this).balance != 0) {
    revert NonZeroRemainder();
}
```

#### Issue 5: Self-Transfer Not Blocked
**V1 Problem:** Allowed `destination == user` for same-chain sweeps.

**Risk:** Self-transfer is a no-op that would violate the zero-balance promise (funds stay in same account).

**V2 Fix:**
```solidity
if (sweep.destination == address(0) || sweep.destination == address(this)) {
    revert InvalidDestination();
}
```

#### Issue 6: Cross-Chain Needed Semantic Parameters
**V1 Problem:** Cross-chain used arbitrary calldata that users couldn't verify.

**Risk:** Users had no way to verify what the bridge calldata would actually do.

**V2 Fix:** Users sign **semantic parameters** (destinationChainId, destination, minReceive, refundRecipient), and the adapter interface enforces them:
```solidity
struct CrossChainSweep {
    address user;
    uint256 destinationChainId;  // User signs this
    address destination;          // User signs this
    address relayer;
    address adapter;
    address refundRecipient;      // User signs this
    uint256 maxRelayerFee;
    uint256 minReceive;           // User signs this - on-chain protection
    uint256 deadline;
    uint256 nonce;
}
```

#### Issue 7: Separate Same-Chain vs Cross-Chain Functions
**V1 Problem:** Single function tried to handle all cases.

**Risk:** Complex conditional logic increases attack surface and gas costs.

**V2 Fix:** Two separate functions with distinct security models:
- `executeSameChainSweep()` - Simpler, allows permissionless execution
- `executeCrossChainSweep()` - More complex, requires pinned relayer

#### Issue 8: Adapter Allowlist Stored in Storage
**V1 Problem (draft):** Early V2 drafts stored adapters in storage.

**Risk:** Under EIP-7702, storage reads go to the user's EOA storage, not the contract. A malicious adapter could be "injected" into user storage.

**V2 Fix:** Adapters stored as immutables (in bytecode):
```solidity
address public immutable adapter0;
address public immutable adapter1;
address public immutable adapter2;
address public immutable adapter3;
uint8 public immutable adapterCount;
```

#### Issue 9: Domain Separator Chain ID Handling
**V1 Problem:** Hardcoded domain separator without fork protection.

**Risk:** After a chain fork, signatures could be replayed on both chains.

**V2 Fix:** Cache at deployment, recompute if chain ID changes:
```solidity
function _domainSeparator() internal view returns (bytes32) {
    if (block.chainid == INITIAL_CHAIN_ID) {
        return INITIAL_DOMAIN_SEPARATOR;
    }
    return _computeDomainSeparator();
}
```

#### Issue 10: refundRecipient Must Be Signed
**V1 Problem (draft):** Early V2 drafts used implicit refund recipient.

**Risk:** Front-running attacks could redirect bridge refunds.

**V2 Fix:** `refundRecipient` is explicitly part of the signed struct:
```solidity
bytes32 public constant CROSS_CHAIN_SWEEP_TYPEHASH = keccak256(
    "CrossChainSweep(address user,uint256 destinationChainId,address destination,address relayer,address adapter,address refundRecipient,uint256 maxRelayerFee,uint256 minReceive,uint256 deadline,uint256 nonce)"
);
```

#### Issue 11: Cross-Chain Requires Pinned Relayer
**V1 Problem (draft):** Early V2 drafts allowed permissionless cross-chain execution.

**Risk:** For wallet-provider integrations, stronger guarantees are needed.

**V2 Fix:** Cross-chain sweeps MUST have `sweep.relayer != address(0)`:
```solidity
if (sweep.relayer == address(0)) {
    revert RelayerRequired();
}
```

#### Issue 12: refundRecipient Must Equal Relayer
**V1 Problem (draft):** Early V2 allowed any refundRecipient.

**Risk:** Complex refund routing could introduce vulnerabilities.

**V2 Fix:** Protocol enforces `refundRecipient == relayer`:
```solidity
if (sweep.refundRecipient == address(0) || sweep.refundRecipient != sweep.relayer) {
    revert InvalidRefundRecipient();
}
```

This simplifies the security model: users are protected by `minReceive` on the destination chain, and any bridge refunds go to the relayer who executed the transaction.

#### Issue 13: Custom Errors Over Require Strings
**V1 Problem:** Used `require(condition, "error string")`.

**Risk:** Higher gas costs, less structured error handling.

**V2 Fix:** All errors are custom:
```solidity
error InvalidExecutionContext();
error InvalidSignature();
error DeadlineExpired();
error InvalidNonce();
error ZeroBalance();
error InvalidDestination();
error InvalidAdapter();
error UnauthorizedRelayer();
error TransferFailed();
error AdapterCallFailed();
error NonZeroRemainder();
error InvalidRefundRecipient();
error RelayerRequired();
error TooManyAdapters();
error ZeroAdapter();
error DuplicateAdapter();
```

#### Issue 14: r/s Zero Check
**V1 Problem:** No validation of r=0 or s=0 in signatures.

**Risk:** Micro-hardening against edge cases.

**V2 Fix:**
```solidity
if (r == 0 || s == 0) {
    revert InvalidSignature();
}
```

#### Issue 15: Duplicate Adapter Check
**V1 Problem (draft):** No check for duplicate adapters in constructor.

**Risk:** Same adapter could be added multiple times, wasting slots.

**V2 Fix:**
```solidity
for (uint256 i = 0; i < _adapters.length; i++) {
    if (_adapters[i] == address(0)) revert ZeroAdapter();
    for (uint256 j = i + 1; j < _adapters.length; j++) {
        if (_adapters[i] == _adapters[j]) revert DuplicateAdapter();
    }
}
```

#### Issue 16: Event Includes refundRecipient
**V1 Problem (draft):** Early V2 events didn't include refundRecipient.

**Risk:** Harder to track where refunds go for debugging/monitoring.

**V2 Fix:**
```solidity
event CrossChainSweepExecuted(
    address indexed user,
    uint256 indexed destinationChainId,
    address destination,
    address adapter,
    address refundRecipient,  // Added
    uint256 amountBridged,
    uint256 relayerFee,
    uint256 minReceive,
    address relayer,
    uint256 nonce
);
```

---

## IZeroDustAdapter.sol

### Why This Interface Was Created

The interface defines the contract between ZeroDustSweepV2 and bridge adapters:

```solidity
interface IZeroDustAdapter {
    function executeNativeBridge(
        uint256 destinationChainId,
        address destination,
        uint256 minReceive,
        address refundRecipient,
        bytes calldata adapterData
    ) external payable;

    function bridgeName() external view returns (string memory);
    function supportedChainIds() external view returns (uint256[] memory);
    function supportsChain(uint256 chainId) external view returns (bool);
}
```

### Key Design Decisions

1. **Semantic Parameters First**: The adapter receives user-signed parameters (destinationChainId, destination, minReceive, refundRecipient) as explicit arguments, not buried in calldata.

2. **adapterData for Routing**: Bridge-specific routing data (quotes, routes) goes in `adapterData`, computed by the backend.

3. **refundRecipient Explicit**: Adapters MUST NOT refund to `msg.sender` (which is the user's EOA). They MUST use `refundRecipient`.

4. **View Functions**: `bridgeName()`, `supportedChainIds()`, `supportsChain()` enable frontend/backend to discover adapter capabilities.

---

## BungeeAdapter.sol

### Why This Adapter Was Created

Bungee (Socket) is the first bridge integration for ZeroDust. They provided an API key for the integration.

### Choice: Bungee Auto vs Bungee Manual

| Aspect | Bungee Auto | Bungee Manual |
|--------|-------------|---------------|
| **Routing** | Solver auction (automatic) | User selects bridge |
| **Contract** | BungeeInbox (different per chain) | SocketGateway (same all chains) |
| **UX** | Simpler - just "Sweep" | Complex - route selection |
| **Pricing** | Competitive (auction) | Fixed quote |

**Decision:** Bungee Auto was chosen because:
1. Aligns with ZeroDust's "just make it zero" philosophy
2. Simpler UX - users don't need to understand bridges
3. Potentially better pricing due to solver competition

### BungeeInbox Addresses (Mainnet)

| Chain | Address |
|-------|---------|
| Ethereum | `0x92612711D4d07dEbe4964D4d1401D7d7B5a11737` |
| Arbitrum | `0xA3BF43451CdEb6DEC588B8833838fC419CE4F54c` |
| Base | `0x3C54883Ce0d86b3abB26A63744bEb853Ea99a403` |
| Optimism | `0x78255f1DeE074fb7084Ee124058A058dE0B1C251` |
| Polygon | `0xFEfFE1D89542C111845648a107811Fb272EaE0Da` |
| BSC | `0x002cd45978F556D817e5FBB4020f7Dd82Bb10941` |

### Backend Integration Flow

```
1. GET /api/v1/bungee/quote
   - fromChainId, toChainId
   - fromTokenAddress: 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE (native)
   - toTokenAddress: 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE (native)
   - fromAmount, userAddress, recipient
   Headers: x-api-key: <API_KEY>

2. GET /api/v1/bungee/build-tx?quoteId=<QUOTE_ID>
   Headers: x-api-key: <API_KEY>
   Response: { txData: { to, value, data } }

3. Pass txData.data as adapterData to executeNativeBridge

4. Poll GET /api/v1/bungee/status?requestHash=<HASH>
   Until status reaches FULFILLED (3) or SETTLED (4)
```

### Status Codes

| Code | Status | Meaning |
|------|--------|---------|
| 0 | PENDING | Request submitted, awaiting solver |
| 1 | ASSIGNED | Solver assigned |
| 2 | EXTRACTED | Funds pulled from source |
| 3 | FULFILLED | Delivered on destination |
| 4 | SETTLED | Fully complete |
| 5 | EXPIRED | Timed out |
| 6 | CANCELLED | Cancelled |
| 7 | REFUNDED | Refund processed |

---

## foundry.toml Changes

### Change: `via_ir = true`

**Reason:** The `CrossChainSweep` struct has 10 fields, causing "Stack too deep" compilation errors with the standard Solidity compiler pipeline.

**Solution:** Enable the IR-based optimizer which handles stack management more efficiently:

```toml
[profile.default]
via_ir = true
```

**Trade-offs:**
- Slower compilation (~2-3x)
- Sometimes different gas characteristics
- More robust stack handling

---

## File Structure After Changes

```
contracts/
├── src/
│   ├── ZeroDustSweep.sol          # V1 (existing, deployed on testnets)
│   ├── ZeroDustSweepV2.sol        # V2 (new, for mainnet)
│   ├── interfaces/
│   │   └── IZeroDustAdapter.sol   # Adapter interface (new)
│   └── adapters/
│       └── BungeeAdapter.sol      # Bungee Auto adapter (new)
├── test/
│   └── ZeroDustSweep.t.sol        # Tests for V1
├── script/
│   └── Deploy.s.sol               # Deployment script
└── foundry.toml                   # Build config (modified)
```

---

## Security Review Summary

ZeroDustSweepV2 underwent 7 rounds of advisor review:

| Round | Key Issues Addressed |
|-------|---------------------|
| 1 | Execution context binding, ERC-7201 storage, zero balance enforcement, destination==self check, domain separator fork protection, adapter interface |
| 2 | maxBridgeFee removal, adapter refund handling, duplicate adapter check, r/s==0 check |
| 3 | refundRecipient must be signed |
| 4 | Custom errors over require strings |
| 5 | Emit refundRecipient in event, permissionless relayer policy discussion |
| 6 | Decision: require pinned relayer for cross-chain |
| 7 | Dedicated RelayerRequired error, enforce refundRecipient == relayer |

**Final Status:** Approved with no further changes required.

---

## Migration Notes

### From V1 to V2

1. **New Contract Address**: V2 will be deployed to a new address (CREATE2 deterministic)
2. **New Signatures Required**: V2 uses different EIP-712 type hashes
3. **Cross-Chain Support**: V2 adds cross-chain via adapters (V1 was same-chain only)
4. **Stricter Validation**: V2 enforces zero balance post-condition

### Testnet Deployments

**V1:** Deployed on 45 testnets at `0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC` (with exceptions for Cronos, XRPL EVM, and Arc).

**V2 Sepolia - REAL Cross-Chain Verified (January 8, 2026):**

| Contract | Address | Purpose |
|----------|---------|---------|
| ZeroDustSweepV2 | `0xC55A663941140c81E53193f08B1Db50c9F116e5b` | Main V2 contract |
| OPStackAdapter | `0x9C2f130060Ff97C948377C1eD93dBfac3581b56F` | Real bridge (→ Base Sepolia) |
| MockAdapter | `0x1575bfcA866807569B5260546C0Ac81912637f38` | Testing adapter |

**All 3 Sweep Cases Verified ✅:**

| Case | Type | Source | Destination | Result | TX |
|------|------|--------|-------------|--------|-----|
| 1 | Same-chain, diff addr | Sepolia | Sepolia | **0 wei** ✅ | `0xd8d7...` |
| 2 | Cross-chain, same addr | Sepolia | Base Sepolia | **0 wei** ✅ | `0x178d...` |
| 3 | Cross-chain, diff addr | Sepolia | Base Sepolia | **0 wei** ✅ | `0x6f62...` |

Cross-chain funds verified received on Base Sepolia (15,000,000,000,000 wei each).

**Next Steps:**
1. Deploy BungeeAdapter for mainnet cross-chain routing
2. Backend integration with V2 contracts
3. Mainnet deployment after audit

---

## OPStackAdapter.sol

### Why This Adapter Was Created

Bungee doesn't support testnets, so we needed a real bridge adapter for testnet cross-chain testing. The OP Stack native bridge (L1StandardBridge) provides:
- Real cross-chain bridging on testnets
- No third-party dependency
- Fast L1→L2 (~2-10 minutes)
- 1:1 transfer (no slippage)

### Architecture

```
Sepolia (L1)                          Base Sepolia (L2)
┌─────────────────┐                   ┌─────────────────┐
│ OPStackAdapter  │                   │                 │
│       ↓         │                   │                 │
│ L1StandardBridge│ ──── bridge ────► │ L2StandardBridge│
│ depositETHTo()  │                   │ (receives ETH)  │
└─────────────────┘                   └─────────────────┘
```

### L1StandardBridge Addresses

| L2 Chain | L1StandardBridge on Sepolia |
|----------|----------------------------|
| Base Sepolia | `0xfd0Bf71F60660E2f608ed56e1659C450eB113120` |
| Optimism Sepolia | TBD |
| Mode Sepolia | TBD |

### Key Implementation Details

```solidity
// OPStackAdapter stores bridge address and destination chain as immutables
constructor(address _l1StandardBridge, uint256 _destinationChain) {
    l1StandardBridge = _l1StandardBridge;
    destinationChain = _destinationChain;
}

// Calls L1StandardBridge.depositETHTo()
function executeNativeBridge(...) external payable {
    l1StandardBridge.call{value: msg.value}(
        abi.encodeWithSelector(
            bytes4(0x9a2ac6d5), // depositETHTo
            _destination,
            MIN_GAS_LIMIT,
            ""
        )
    );
}
```

**Note:** Each OP Stack L2 requires its own OPStackAdapter instance (different bridge addresses).

---

## API Reference

### Base URLs

| Environment | URL | Auth |
|-------------|-----|------|
| Public Sandbox | `https://public-backend.bungee.exchange/` | None |
| Dedicated | `https://dedicated-backend.bungee.exchange/` | `x-api-key` header |

### Rate Limits

- Public Sandbox: Very limited (shared)
- Dedicated: 20 RPS (extensible)

---

## References

- [Bungee API Documentation](https://docs.bungee.exchange/bungee-api/)
- [Bungee Contract Addresses](https://docs.bungee.exchange/bungee-api/contract-addresses/)
- [Bungee Integration Guides](https://docs.bungee.exchange/bungee-api/integration-guides/)
- [EIP-7702 Specification](https://eips.ethereum.org/EIPS/eip-7702)
- [EIP-712 Specification](https://eips.ethereum.org/EIPS/eip-712)
- [ERC-7201 Namespaced Storage](https://eips.ethereum.org/EIPS/eip-7201)
