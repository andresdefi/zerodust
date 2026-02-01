# ZeroDust Security Properties

This document describes the security properties of ZeroDust V3, particularly the **pass-through architecture** that ensures user funds are never held by the protocol.

## Core Security Property: Zero Custody

ZeroDust is a **non-custodial, pass-through protocol**. User funds flow directly to their destination in a single atomic transaction. The protocol never holds, stores, or has custody of user funds at any point.

This property is enforced at the smart contract level and is verifiable on-chain.

---

## Fund Flow Analysis

### How EIP-7702 Changes the Model

Traditional protocols receive funds into their contract address. ZeroDust uses EIP-7702 (account abstraction via code delegation) which fundamentally changes this:

1. User signs an EIP-7702 authorization delegating their EOA to ZeroDust contract code
2. The contract code executes **in the context of the user's address**
3. Funds transfer directly from user's address to destination(s)
4. ZeroDust contract address **never receives or holds any ETH**

```
Traditional Model:
User → Protocol Contract → Destination
        (holds funds)

ZeroDust Model (EIP-7702):
User's EOA (running ZeroDust code) → Destination
        (no intermediary)
```

---

## Three Use Cases

ZeroDust supports three sweep patterns. All three maintain the zero-custody property.

### Case 1: Same-Chain Sweep (MODE_TRANSFER)

User sweeps their entire balance to a different address on the same chain.

**Fund Flow:**
```
User's EOA
    │
    ├──► Sponsor (fee reimbursement)
    │
    └──► Destination Address (remainder)

User's final balance: 0 wei
```

### Case 2: Cross-Chain Sweep (MODE_CALL)

User sweeps their entire balance to another chain via bridge.

**Fund Flow:**
```
User's EOA
    │
    ├──► Sponsor (fee reimbursement)
    │
    └──► Bridge (callTarget) ──► Destination Chain
         (pass-through)

User's final balance: 0 wei
Bridge's balance: 0 wei (100% passed through)
```

---

## Protocol Enforcement

The zero-custody property is **enforced at the protocol level**, not merely a design choice. The contract will revert if any funds remain after execution.

### Mandatory Zero Balance Check

The sweep function includes a mandatory check that reverts if any balance remains:

**V3 executeSweep:**
```solidity
// ============ ENFORCE CORE PROMISE: Zero Balance ============
if (address(this).balance != 0) {
    revert NonZeroRemainder();
}
```

### Pass-Through Guarantee

For MODE_CALL (cross-chain), the bridge receives 100% of the bridged amount:

```solidity
// Call bridge with full amount
(bool success, ) = intent.callTarget.call{value: amountToBridge}(callData);
if (!success) revert BridgeCallFailed();
```

---

## V3 Security Features

| Feature | Description |
|---------|-------------|
| **Unified SweepIntent** | Single signed structure prevents confusion |
| **Mode field** | Clear separation of transfer vs call behavior |
| **routeHash** | Signature bound to specific bridge route |
| **maxTotalFeeWei** | Hard cap on total fees |
| **Granular fees** | Transparent breakdown of all fee components |
| **Immutable sponsors** | Stored in bytecode, not storage |
| **ERC-7201 storage** | Namespaced nonces prevent collisions |
| **EIP-712 per-user domain** | verifyingContract is user's EOA |

---

## Verification Checklist

Auditors and reviewers can verify the zero-custody property:

### 1. No Fund Storage
- [ ] Contract has no `receive()` or `fallback()` that accepts ETH
- [ ] No state variables store ETH balances
- [ ] No withdrawal functions exist (nothing to withdraw)

### 2. Atomic Execution
- [ ] All transfers occur in a single transaction
- [ ] No multi-step processes that could leave funds in limbo
- [ ] CEI (Checks-Effects-Interactions) pattern followed

### 3. Mandatory Zero Balance
- [ ] `executeSweep()` reverts if `balance != 0` after transfers
- [ ] `NonZeroRemainder` error is defined and used

### 4. On-Chain Verification
- [ ] Internal transactions show direct User → Destination flow
- [ ] User balance is exactly 0 after transaction

---

## Attack Surface Analysis

### What ZeroDust Does NOT Have

| Risk | ZeroDust | Typical DeFi |
|------|----------|--------------|
| Fund custody | No | Yes |
| Admin withdrawal | No | Often |
| Pausable funds | No | Often |
| Upgradeable storage | No | Often |
| Multi-sig control | No | Often |

### What ZeroDust Does Have

| Property | Description |
|----------|-------------|
| Immutable code | No proxy, no upgrades |
| Immutable sponsor list | Set at deployment, cannot be changed |
| User signature required | All operations require valid EIP-712 signature |
| Atomic execution | All-or-nothing in single transaction |
| Zero balance guarantee | Protocol-enforced, reverts otherwise |

---

## Conclusion

ZeroDust V3's architecture fundamentally prevents fund custody:

1. **EIP-7702 execution context** - Code runs in user's address, not protocol's
2. **Direct transfers** - Funds flow directly to destination
3. **Pass-through bridges** - Bridge calls forward 100% of received ETH
4. **Protocol enforcement** - Transactions revert if any balance remains
5. **No storage** - No state variables, no balances, no withdrawal functions

The protocol is designed so that even a malicious sponsor cannot steal funds - they can only execute the sweep as signed by the user, and the destination is cryptographically committed in the signature.

---

*Document Version: 2.0*
*Last Updated: January 2026*
*Applies to: ZeroDustSweepMainnet, ZeroDustSweepTEST*
