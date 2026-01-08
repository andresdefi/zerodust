# ZeroDust Security Properties

This document describes the security properties of ZeroDust, particularly the **pass-through architecture** that ensures user funds are never held by the protocol.

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

### Case 1: Same-Chain Sweep (Different Address)

User sweeps their entire balance to a different address on the same chain.

**Fund Flow:**
```
User's EOA
    │
    ├──► Relayer (fee)
    │
    └──► Destination Address (remainder)

User's final balance: 0 wei
```

**Verified Transaction:** [0x9dc76f91...](https://sepolia.etherscan.io/tx/0x9dc76f9111b8cb1740c89a692699e5957829d951f24950dad5b87bdc9c5b1769#internal)

**Code Reference:** [`ZeroDustSweepV2.sol` lines 313-322](src/ZeroDustSweepV2.sol#L313-L322)
```solidity
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
```

---

### Case 2: Cross-Chain Sweep (Same Address)

User sweeps their entire balance to the same address on a different chain.

**Fund Flow:**
```
User's EOA
    │
    ├──► Relayer (fee)
    │
    └──► Bridge Adapter ──► L1StandardBridge ──► [L2 Destination]
         (pass-through)     (OP Stack bridge)

User's final balance: 0 wei
Adapter's balance: 0 wei (100% passed through)
```

**Verified Transaction:** [0x6fdb6739...](https://sepolia.etherscan.io/tx/0x6fdb6739da1df0c3974f7540cac13b7beeede6018b00f351a14ea8832b869be4#internal)

---

### Case 3: Cross-Chain Sweep (Different Address)

User sweeps their entire balance to a different address on a different chain.

**Fund Flow:**
```
User's EOA
    │
    ├──► Relayer (fee)
    │
    └──► Bridge Adapter ──► L1StandardBridge ──► [L2 Destination]
         (pass-through)     (OP Stack bridge)

User's final balance: 0 wei
Adapter's balance: 0 wei (100% passed through)
```

**Verified Transaction:** [0xfac1e8f7...](https://sepolia.etherscan.io/tx/0xfac1e8f7cf2f47058c5571baa3fca41c052177a6002d2b069a4cb35f78d19a10#internal)

---

## Protocol Enforcement

The zero-custody property is **enforced at the protocol level**, not merely a design choice. The contract will revert if any funds remain after execution.

### Mandatory Zero Balance Check

Both sweep functions include a mandatory check that reverts if any balance remains:

**Same-Chain Sweep** ([line 326](src/ZeroDustSweepV2.sol#L326)):
```solidity
// ============ ENFORCE CORE PROMISE: Zero Balance ============
// If destination sent ETH back or any other edge case, revert
if (address(this).balance != 0) {
    revert NonZeroRemainder();
}
```

**Cross-Chain Sweep** ([line 477](src/ZeroDustSweepV2.sol#L477)):
```solidity
// ============ ENFORCE CORE PROMISE: Zero Balance ============
// If adapter refunded ETH or any other edge case, revert
if (address(this).balance != 0) {
    revert NonZeroRemainder();
}
```

### Adapter Pass-Through Guarantee

Bridge adapters are required to forward 100% of received funds to the bridge. The adapter never stores funds:

**UniversalOPStackAdapter** ([lines 98-105](src/adapters/UniversalOPStackAdapter.sol#L98-L105)):
```solidity
// Call L1StandardBridge.depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData)
(bool success, ) = bridge.call{value: msg.value}(
    abi.encodeWithSelector(
        bytes4(0x9a2ac6d5), // depositETHTo
        _destination,
        MIN_GAS_LIMIT,
        ""
    )
);
```

Key: `{value: msg.value}` forwards 100% of received ETH to the bridge.

---

## Verification Checklist

Auditors and reviewers can verify the zero-custody property:

### 1. No Fund Storage
- [ ] `ZeroDustSweepV2` has no `receive()` or `fallback()` functions that accept ETH
- [ ] No state variables store ETH balances
- [ ] No withdrawal functions exist (nothing to withdraw)

### 2. Atomic Execution
- [ ] All transfers occur in a single transaction
- [ ] No multi-step processes that could leave funds in limbo
- [ ] CEI (Checks-Effects-Interactions) pattern followed

### 3. Mandatory Zero Balance
- [ ] `executeSameChainSweep()` reverts if `balance != 0` after transfers
- [ ] `executeCrossChainSweep()` reverts if `balance != 0` after adapter call
- [ ] `NonZeroRemainder` error is defined and used

### 4. Adapter Pass-Through
- [ ] Adapters use `{value: msg.value}` to forward 100% of ETH
- [ ] Adapters have no storage of funds
- [ ] Adapters have no withdrawal mechanisms

### 5. On-Chain Verification
- [ ] Internal transactions show direct User → Destination flow
- [ ] Adapter balance is 0 after transaction
- [ ] User balance is exactly 0 after transaction

---

## Test Transactions (Sepolia)

All three cases have been tested and verified on Sepolia testnet:

| Case | Transaction | Final Balance | Internal TXs |
|------|-------------|---------------|--------------|
| Same-chain, different address | [0x9dc76f91...](https://sepolia.etherscan.io/tx/0x9dc76f9111b8cb1740c89a692699e5957829d951f24950dad5b87bdc9c5b1769) | 0 wei | [View](https://sepolia.etherscan.io/tx/0x9dc76f9111b8cb1740c89a692699e5957829d951f24950dad5b87bdc9c5b1769#internal) |
| Cross-chain, same address | [0x6fdb6739...](https://sepolia.etherscan.io/tx/0x6fdb6739da1df0c3974f7540cac13b7beeede6018b00f351a14ea8832b869be4) | 0 wei | [View](https://sepolia.etherscan.io/tx/0x6fdb6739da1df0c3974f7540cac13b7beeede6018b00f351a14ea8832b869be4#internal) |
| Cross-chain, different address | [0xfac1e8f7...](https://sepolia.etherscan.io/tx/0xfac1e8f7cf2f47058c5571baa3fca41c052177a6002d2b069a4cb35f78d19a10) | 0 wei | [View](https://sepolia.etherscan.io/tx/0xfac1e8f7cf2f47058c5571baa3fca41c052177a6002d2b069a4cb35f78d19a10#internal) |

### Contract Addresses (Sepolia)

| Contract | Address | Verified |
|----------|---------|----------|
| ZeroDustSweepV2 | `0x79865025e3884C208Ece4C510c0e611b16b9bba3` | [Etherscan](https://sepolia.etherscan.io/address/0x79865025e3884C208Ece4C510c0e611b16b9bba3#code) |
| UniversalOPStackAdapter | `0xC0773F9a0Ab3886b2c3C92bb12e2c1d76bea43da` | [Etherscan](https://sepolia.etherscan.io/address/0xC0773F9a0Ab3886b2c3C92bb12e2c1d76bea43da#code) |

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
| Immutable adapter list | Set at deployment, cannot be changed |
| User signature required | All operations require valid EIP-712 signature |
| Atomic execution | All-or-nothing in single transaction |
| Zero balance guarantee | Protocol-enforced, reverts otherwise |

---

## Conclusion

ZeroDust's architecture fundamentally prevents fund custody:

1. **EIP-7702 execution context** - Code runs in user's address, not protocol's
2. **Direct transfers** - Funds flow directly to destination
3. **Pass-through adapters** - Bridge adapters forward 100% of received ETH
4. **Protocol enforcement** - Transactions revert if any balance remains
5. **No storage** - No state variables, no balances, no withdrawal functions

The protocol is designed so that even a malicious relayer cannot steal funds - they can only execute the sweep as signed by the user, and the destination is cryptographically committed in the signature.

---

*Document Version: 1.0*
*Last Updated: January 2026*
*Applies to: ZeroDustSweepV2, UniversalOPStackAdapter*
