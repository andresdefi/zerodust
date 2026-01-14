# ZeroDustSweepV3 Specification

**Version:** 3.0
**Last Updated:** January 12, 2026
**Status:** Design Complete - Ready for Implementation

---

## Overview

ZeroDustSweepV3 is a significant evolution from V2, designed for operational simplicity across 40+ chains while maintaining security guarantees. The key innovations are:

1. **Unified Entry Point** - Single `sweep()` function handles both same-chain and cross-chain
2. **Sponsor-Only Execution** - No permissionless mode; single trusted sponsor
3. **No Adapter Allowlist** - Generic `callTarget + callData` pattern for any bridge/DEX
4. **Per-Intent Fee Tuning** - Gas price caps and fee parameters travel with the intent
5. **Chain-Agnostic Bytecode** - Same constructor params deploy everywhere

---

## V2 vs V3 Comparison

### Architecture Changes

| Aspect | V2 | V3 |
|--------|----|----|
| **Entry points** | 2 (`executeSameChainSweep`, `executeCrossChainSweep`) | 1 (`sweep`) |
| **Mode system** | Implicit (which function) | Explicit (`MODE_TRANSFER=0`, `MODE_CALL=1`) |
| **Bridge routing** | Typed adapter interface + allowlist | Generic `callTarget.call{value}(callData)` |
| **Route binding** | None (V2 trusted adapter) | `routeHash = keccak256(callData)` |
| **Executor** | Per-intent `relayer` field | Single immutable `SPONSOR` |
| **Reentrancy guard** | None explicit | Explicit `_entered` flag |

### Fee Model Changes

| Aspect | V2 | V3 |
|--------|----|----|
| **User signs** | `maxRelayerFee` | `maxTotalFeeWei` + per-intent params |
| **Fee calculation** | `min(balance, maxRelayerFee)` | `(gasUsed + overhead + protocolFee) × min(gasPrice, cap) + extraFee` |
| **Gas price cap** | None | Per-intent `reimbGasPriceCapWei` (bounded by global max) |
| **Overhead** | None | Per-intent `overheadGasUnits` (bounded) |
| **Protocol fee** | None | Per-intent `protocolFeeGasUnits` (bounded) |
| **Flat fee** | None | Per-intent `extraFeeWei` (bounded) |
| **Unused fee** | Goes to destination | **Goes to sponsor** |
| **Fee tunability** | None (redeploy) | Per-intent within immutable bounds |

### Signature Structure

**V2 Same-Chain (6 fields):**
```
SameChainSweep(address user, address destination, address relayer,
               uint256 maxRelayerFee, uint256 deadline, uint256 nonce)
```

**V2 Cross-Chain (10 fields):**
```
CrossChainSweep(address user, uint256 destinationChainId, address destination,
                address relayer, address adapter, address refundRecipient,
                uint256 maxRelayerFee, uint256 minReceive, uint256 deadline, uint256 nonce)
```

**V3 Unified (14 fields):**
```
SweepIntent(uint8 mode, address user, address destination, uint256 destinationChainId,
            address callTarget, bytes32 routeHash, uint256 minReceive,
            uint256 maxTotalFeeWei, uint256 overheadGasUnits, uint256 protocolFeeGasUnits,
            uint256 extraFeeWei, uint256 reimbGasPriceCapWei, uint256 deadline, uint256 nonce)
```

---

## What V3 Removes

### 1. Adapter Allowlist

**V2:** Contract maintained an immutable list of up to 4 approved adapters. Adding a new bridge required deploying a new contract version.

**V3:** No allowlist. Any contract can be called via `MODE_CALL`. Security comes from:
- `routeHash` binds the exact calldata to the signature
- Sponsor (you) controls what quotes are offered
- User trusts the sponsor's quote engine

### 2. Per-Intent Relayer Selection

**V2:** Each intent could specify `relayer = address(0)` for permissionless or a specific address.

**V3:** Single `SPONSOR` immutable. Only the sponsor can execute. This simplifies:
- No "who can execute" logic
- Clear revenue model
- Single point of operational control

### 3. Refund Recipient Field

**V2:** Cross-chain intents had `refundRecipient` (had to equal `relayer`).

**V3:** Removed. In `MODE_CALL`, the called contract handles its own refund logic. If the bridge returns funds, they come back to `address(this)` which would cause `NonZeroRemainder` revert - this is intentional and expected behavior.

### 4. Separate Interfaces for Adapters

**V2:** Required `IZeroDustAdapter` interface with specific function signature.

**V3:** No interface required. Any contract that accepts ETH via `call{value}(callData)` works. This enables integration with:
- Gas.zip (direct API calls)
- Bungee/Socket
- 1inch
- Any DEX aggregator
- Custom bridges

---

## What V3 Adds

### 1. Per-Intent Gas Price Cap

```solidity
uint256 reimbGasPriceCapWei;   // per-intent reimb cap (<= MAX_REIMB_GAS_PRICE_CAP_WEI)
```

**Purpose:** Protects users from gas spikes between quote and execution.

**How it works:**
- Quote engine sets `reimbGasPriceCapWei` based on current chain conditions
- Contract calculates: `reimbGasPrice = min(tx.gasprice, reimbGasPriceCapWei)`
- If sponsor bids higher to get included, they absorb the difference

### 2. Protocol Fee Gas Units

```solidity
uint256 protocolFeeGasUnits;   // per-intent protocol margin (<= MAX_PROTOCOL_FEE_GAS_UNITS)
```

**Purpose:** Your on-chain revenue mechanism.

**How it works:**
- Quote engine calculates service fee (10%, min $0.05, max $3)
- Converts to gas units: `protocolFeeGasUnits = serviceFeeWei / expectedGasPrice`
- Reimbursement includes: `protocolFeeGasUnits × actualGasPrice`

### 3. Overhead Gas Units

```solidity
uint256 overheadGasUnits;      // per-intent risk margin (<= MAX_OVERHEAD_GAS_UNITS)
```

**Purpose:** Buffer for unmeasured gas costs (21k base, calldata, etc.).

**How it works:**
- Quote engine estimates overhead based on chain and operation type
- Added to measured gas in reimbursement calculation
- Covers variance between estimated and actual execution

### 4. Extra Fee Wei

```solidity
uint256 extraFeeWei;           // per-intent fixed wei add-on (<= MAX_EXTRA_FEE_WEI)
```

**Purpose:** Fixed fee component, useful on L2s where gas is near-zero.

**How it works:**
- Added directly to reimbursement (not multiplied by gas price)
- Useful when gas costs are negligible but you still want minimum fee

### 5. Route Hash Binding

```solidity
bytes32 routeHash;             // keccak256(callData)
```

**Purpose:** Cryptographically binds the exact route/calldata to the signature.

**How it works:**
- For `MODE_TRANSFER`: must be `keccak256("")`
- For `MODE_CALL`: must equal `keccak256(callData)`
- Prevents sponsor from substituting a different route after user signs

### 6. Explicit Reentrancy Guard

```solidity
uint256 private _entered; // reentrancy guard

function _nonReentrant() internal {
    if (_entered == 1) revert Reentrancy();
    _entered = 1;
}
```

**Purpose:** Defense-in-depth against reentrancy attacks.

---

## Constructor Parameters

```solidity
constructor(
    address sponsor,              // Your hot wallet address (TBD)
    uint256 maxOverheadGasUnits,  // 300,000
    uint256 maxProtocolFeeGasUnits, // 100,000
    uint256 maxExtraFeeWei,       // 0.0005 ETH (5 × 10^14 wei)
    uint256 maxReimbGasPriceCapWei // 1000 gwei (10^12 wei)
)
```

**Key Design:** Same parameters on ALL chains. These are ceilings, not targets. Quote engine picks appropriate per-intent values well below these limits.

### Recommended Values

| Parameter | Recommended Value | Rationale |
|-----------|------------------|-----------|
| `sponsor` | TBD (hot wallet) | The only address allowed to call `sweep()` |
| `maxOverheadGasUnits` | 300,000 | Reasonable ceiling, auditor-friendly |
| `maxProtocolFeeGasUnits` | 100,000 | Allows ~$5 fee at 50 gwei (sufficient for $3 max service fee) |
| `maxExtraFeeWei` | 5 × 10^14 (0.0005 ETH) | ~$1.25 max flat fee |
| `maxReimbGasPriceCapWei` | 10^12 (1000 gwei) | Covers L1 congestion spikes |

### Sponsor Policy Limits (Off-Chain Enforcement)

The on-chain maxima are generous ceilings. Your quote engine/sponsor should enforce **stricter** policy limits:

| Parameter | On-Chain Max | Sponsor Policy Limit |
|-----------|--------------|---------------------|
| `overheadGasUnits` | 300,000 | ≤ 80,000 |
| `protocolFeeGasUnits` | 100,000 | ≤ 30,000 |
| `extraFeeWei` | 0.0005 ETH | ≤ 0.00005 ETH (L2), higher on L1 |
| `maxTotalFeeWei` | User-signed | Tight relative to quoted estimate |

This ensures even if on-chain maxima are generous, your distribution channel cannot accidentally overquote.

---

## Fee Calculation

### On-Chain Formula

```
reimbursement = (measuredGas + overheadGasUnits + protocolFeeGasUnits)
                × min(tx.gasprice, reimbGasPriceCapWei)
                + extraFeeWei
```

### Off-Chain (Quote Engine)

```typescript
// Service fee: 10% with min $0.05, max $3.00
const serviceFeeUsd = Math.max(0.05, Math.min(3.00, balanceUsd * 0.10));
const serviceFeeWei = BigInt(Math.ceil(serviceFeeUsd / ethPriceUsd * 1e18));

// Convert to gas units for on-chain
const expectedGasPrice = await getGasPrice(chainId);
const protocolFeeGasUnits = serviceFeeWei / expectedGasPrice;

// Gas cost estimate
const estimatedGas = 150_000n;
const gasCostWei = estimatedGas * expectedGasPrice;

// Buffer: 50% of gas cost
const bufferWei = gasCostWei * 50n / 100n;

// Total fee cap
const maxTotalFeeWei = serviceFeeWei + gasCostWei + bufferWei;
```

---

## Execution Flow

### MODE_TRANSFER (Same-Chain)

```
1. User signs SweepIntent with mode=0, destination=recipient
2. Sponsor submits sweep(intent, sig, "")
3. Contract:
   a. Validates: deadline, nonce, signature, mode constraints
   b. Reserves: feeReserve = min(balance, maxTotalFeeWei)
   c. Routes: sends (balance - feeReserve) to destination
   d. Reimburses: calculates reimb, sends to SPONSOR
   e. Unused: sends (feeReserve - reimb) to SPONSOR
   f. Enforces: balance == 0
4. User receives funds at destination
5. Sponsor receives fee
```

### MODE_CALL (Cross-Chain via Bridge)

```
1. User signs SweepIntent with mode=1, callTarget=GasZipRouter, routeHash=keccak256(bridgeCalldata)
2. Sponsor submits sweep(intent, sig, bridgeCalldata)
3. Contract:
   a. Validates: deadline, nonce, signature, mode constraints, routeHash
   b. Reserves: feeReserve = min(balance, maxTotalFeeWei)
   c. Routes: calls callTarget.call{value: amountToRoute}(bridgeCalldata)
   d. Reimburses: calculates reimb, sends to SPONSOR
   e. Unused: sends (feeReserve - reimb) to SPONSOR
   f. Enforces: balance == 0
4. Bridge initiates cross-chain transfer
5. User receives funds on destination chain
6. Sponsor receives fee on source chain
```

---

## Domain Separator (EIP-712)

**Critical Change from V2:**

V3 computes domain separator using `address(this)` which under EIP-7702 is the USER's EOA:

```solidity
bytes32 domainSeparator = keccak256(
    abi.encode(
        _EIP712_DOMAIN_TYPEHASH,
        keccak256(bytes(NAME)),
        keccak256(bytes(VERSION)),
        block.chainid,
        address(this)  // USER's EOA under EIP-7702
    )
);
```

**Why this matters:**
- Each user's signature is bound to their specific EOA
- Prevents cross-user replay attacks
- Different from V2 which used the implementation address

---

## Error Conditions

| Error | Condition | User Action |
|-------|-----------|-------------|
| `NotSponsor` | msg.sender != SPONSOR | N/A (backend bug) |
| `Reentrancy` | Reentrant call detected | N/A (attack prevented) |
| `DeadlineExpired` | block.timestamp > deadline | Get new quote |
| `NonceMismatch` | Intent nonce != user's current nonce | Get new quote with fresh nonce |
| `InvalidSignature` | Signature verification failed | Re-sign intent |
| `FeeExceedsCap` | Calculated fee > feeReserve | Get new quote (gas spike) |
| `InsufficientBalance` | amountToRoute == 0 | Balance too low for fees |
| `TargetNotContract` | callTarget has no code | Invalid quote |
| `RouteHashMismatch` | keccak256(callData) != routeHash | Invalid calldata |
| `InvalidMode` | mode not 0 or 1, or wrong params for mode | Invalid quote |
| `CallFailed` | External call reverted | Bridge/DEX issue |
| `NonZeroRemainder` | Balance not zero after execution | Unexpected refund |
| `CapOutOfBounds` | reimbGasPriceCapWei is 0 or > max | Invalid quote |

---

## Security Properties

### Preserved from V2

1. **User funds never custodied** - Atomic single-transaction
2. **User cannot pay more than maxTotalFeeWei** - Enforced on-chain
3. **Sweep always results in zero balance** - `NonZeroRemainder` check
4. **Nonces never reused** - Monotonic increment
5. **Deadlines enforced** - `DeadlineExpired` check
6. **Signature malleability protected** - Low-s check (EIP-2)

### New in V3

1. **Route binding** - `routeHash` prevents route substitution
2. **Gas price protection** - Per-intent `reimbGasPriceCapWei`
3. **Explicit reentrancy guard** - `_entered` flag
4. **Cross-user replay prevention** - Domain separator uses user's EOA

### Removed (Acceptable Trade-offs)

1. **Adapter allowlist** - Replaced by route binding + sponsor trust
2. **Permissionless execution** - Sponsor-only simplifies security model
3. **Refund recipient** - Bridge handles its own refund logic

---

## Migration from V2

### Breaking Changes

1. **New typehash** - V2 signatures won't work on V3
2. **Single entry point** - No more `executeSameChainSweep` / `executeCrossChainSweep`
3. **No adapter interface** - Adapters not needed; use generic call
4. **Domain separator** - Uses user EOA, not implementation address

### Backend Changes Required

1. **Signature service** - Update to V3 types (14 fields)
2. **Quote engine** - Calculate new fee parameters
3. **Relayer** - Call `sweep()` instead of `executeSameChainSweep()` / `executeCrossChainSweep()`
4. **Bridge integration** - Prepare calldata for `MODE_CALL` instead of adapter calls

### SDK Changes Required

1. **Type definitions** - New `SweepIntent` structure
2. **Signing** - Updated EIP-712 types
3. **Quote response** - Include all fee parameters

---

## Deprecation Notice

**V1 and V2 are deprecated.** V3 is the production contract going forward.

| Version | Status | Notes |
|---------|--------|-------|
| V1 | **DEPRECATED** | Testing only, no cross-chain support |
| V2 | **DEPRECATED** | Adapter-based, replaced by V3 |
| **V3** | **ACTIVE** | Production contract |

All new development, testing, and deployments should use V3 exclusively. Existing V1/V2 deployments on testnets are for historical reference only and will not be maintained.

---

## Deployment

### Same Bytecode Everywhere

```bash
# Deploy with identical params on all chains
forge create src/ZeroDustSweepV3.sol:ZeroDustSweepV3 \
  --constructor-args \
    $SPONSOR_ADDRESS \
    300000 \
    100000 \
    500000000000000 \
    1000000000000 \
  --rpc-url $RPC_URL \
  --private-key $DEPLOYER_KEY
```

### Verification

```bash
forge verify-contract $CONTRACT_ADDRESS \
  src/ZeroDustSweepV3.sol:ZeroDustSweepV3 \
  --constructor-args $(cast abi-encode "constructor(address,uint256,uint256,uint256,uint256)" \
    $SPONSOR_ADDRESS 300000 100000 500000000000000 1000000000000) \
  --chain-id $CHAIN_ID
```

### Deployment Order

1. **Sepolia** - Primary testnet for initial testing
2. **Other testnets** - Expand after Sepolia validation
3. **Mainnets** - After thorough testnet verification

---

## Appendix: Typehash Computation

```solidity
bytes32 public constant SWEEP_TYPEHASH = keccak256(
    "SweepIntent(uint8 mode,address user,address destination,uint256 destinationChainId,address callTarget,bytes32 routeHash,uint256 minReceive,uint256 maxTotalFeeWei,uint256 overheadGasUnits,uint256 protocolFeeGasUnits,uint256 extraFeeWei,uint256 reimbGasPriceCapWei,uint256 deadline,uint256 nonce)"
);

// Result: 0x... (compute at deployment)
```

---

*This specification defines ZeroDustSweepV3. Implementation should follow this document exactly.*
