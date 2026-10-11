# ZeroDustSweep Specification

**Version:** 3.0
**Status:** Production, deployed on 52 mainnets at `0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2` (source unchanged since January 2026)

---

## Overview

ZeroDustSweep is designed for operational simplicity across many chains while keeping its security guarantees. The key innovations are:

1. **Unified Entry Point** - Single `sweep()` function handles both same-chain and cross-chain
2. **Sponsor-Only Execution** - No permissionless mode; up to 3 sponsors fixed in the bytecode (deployed with one, the AWS KMS key `0x01eD5c94DE39E73C986b98B85C2c0A3d1BEDff7D`)
3. **No Adapter Allowlist** - Generic `callTarget + callData` pattern for any bridge/DEX
4. **Per-Intent Fee Tuning** - Gas price caps and fee parameters travel with the intent
5. **Chain-Agnostic Bytecode** - Same constructor params deploy everywhere

---

## SweepIntent (14 fields)

```
SweepIntent(uint8 mode, address user, address destination, uint256 destinationChainId,
            address callTarget, bytes32 routeHash, uint256 minReceive,
            uint256 maxTotalFeeWei, uint256 overheadGasUnits, uint256 protocolFeeGasUnits,
            uint256 extraFeeWei, uint256 reimbGasPriceCapWei, uint256 deadline, uint256 nonce)
```

`MODE_CALL` calls any contract with `call{value}(callData)`: there is no adapter allowlist in the
contract. Security comes from `routeHash` binding the exact calldata to the signature, and from the
sponsor's quote engine and the SDK's checks choosing and verifying the target. A bridge that returns
funds to the wallet during the call makes the post-condition fail (`NonZeroRemainder`), which is
intended.

---

## Features

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
- Quote engine calculates service fee (5% under $1 with no minimum; from $1: 1%, min $0.05, max $0.50)
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
    address[] memory sponsors,      // 1 to 3 EOAs, stored as immutables (deployed: the KMS key)
    uint256 minOverheadGasUnits,    // 50,000
    uint256 maxOverheadGasUnits,    // 300,000
    uint256 maxProtocolFeeGasUnits, // 100,000 (the field is unused: always 0)
    uint256 maxExtraFeeWei,         // 1000 ether (tokens as cheap as $0.00005 at the $0.05 minimum fee)
    uint256 maxReimbGasPriceCapWei  // 1000 gwei
)
```

Same parameters on every chain (they are part of the CREATE2 address). These are ceilings; the quote
engine signs per-intent values far below them, and the SDK checks every quote against its own
limits before signing (`FEE_GAS_BUDGET_UNITS`, `MAX_SERVICE_FEE_BPS`, the gas price cap at most 3x the
price it reads).

---

## Fee Calculation

### On-Chain Formula

```
reimbursement = (measuredGas + overheadGasUnits + protocolFeeGasUnits)
                × min(tx.gasprice, reimbGasPriceCapWei)
                + extraFeeWei
```

### Off-Chain (Quote Engine)

The API's quote engine (private backend) fills the intent's fee fields:

- `extraFeeWei`: the service fee (5% of the balance's USD value under $1; from $1, 1% with a $0.05
  minimum and a $0.50 maximum), plus the rollup's L1 data fee and per-chain surcharges.
- `overheadGasUnits`: gas the contract cannot measure itself (intrinsic cost, authorization, the
  bridge call as measured per route).
- `reimbGasPriceCapWei`: 1.2 times the gas price at quote time.
- `maxTotalFeeWei`: the whole reserve: (the route's measured gas + overhead + the revoke's gas) at
  the cap, plus `extraFeeWei`. It
  leaves the wallet in full; the contract reimburses the sponsor and sends the unused part to it.
- `protocolFeeGasUnits`: always 0.

The public field-by-field description is at https://zerodust.xyz/docs/api#fees-in-a-quote.

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

The contract computes the domain separator using `address(this)` which under EIP-7702 is the USER's EOA:

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

### Properties

1. **User funds never custodied** - Atomic single-transaction
2. **User cannot pay more than maxTotalFeeWei** - Enforced on-chain
3. **Sweep always results in zero balance** - `NonZeroRemainder` check
4. **Nonces never reused** - Monotonic increment
5. **Deadlines enforced** - `DeadlineExpired` check
6. **Signature malleability protected** - Low-s check (EIP-2)

1. **Route binding** - `routeHash` prevents route substitution
2. **Gas price protection** - Per-intent `reimbGasPriceCapWei`
3. **Explicit reentrancy guard** - `_entered` flag
4. **Cross-user replay prevention** - Domain separator uses user's EOA

### Trade-offs

1. **No adapter allowlist** - replaced by route binding and the sponsor's and SDK's checks
2. **No permissionless execution** - sponsor only
3. **No refund recipient** - the bridge handles its own refunds; a refund into the wallet during the
   call fails the post-condition

---

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md): `script/DeployMainnet.s.sol` through the CREATE2 factory, salt
`0x5a65726f44757374`, address `0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2` on every chain.

---

## Appendix: Typehash Computation

```solidity
bytes32 public constant SWEEP_TYPEHASH = keccak256(
    "SweepIntent(uint8 mode,address user,address destination,uint256 destinationChainId,address callTarget,bytes32 routeHash,uint256 minReceive,uint256 maxTotalFeeWei,uint256 overheadGasUnits,uint256 protocolFeeGasUnits,uint256 extraFeeWei,uint256 reimbGasPriceCapWei,uint256 deadline,uint256 nonce)"
);

```

---

*This specification describes the deployed ZeroDustSweep (`src/ZeroDustSweepMainnet.sol`).*
