# ZeroDust contracts changelog

The deployed contracts are immutable: a change means a new contract at a new address.

## ZeroDustGuard 1 (2026-10-08)

`src/ZeroDustGuard.yul`, `0x2f95e6ED90a7dD67fc3Fae5c5628647E6A83e48e` on Blast and Boba. Exact-zero
direct sweeps on OP-stack chains whose L1 data fee moves with L1 prices: one legacy transaction
through the guard either leaves the wallet at exactly 0 or reverts and changes nothing but its own
fee. No owner, no storage.

## ZeroDustPermissionRouter v2 (2026-10-06)

`src/ZeroDustPermissionRouter.sol`, `0x369A97dd256F7eb37fF7116C4EcBd50318eBb286` on 16 chains. Sweeps
from MetaMask without a key: redeems a one-time ERC-7715 `native-token-allowance` through MetaMask's
DelegationManager, requires exactly 0, settles like ZeroDustSweep (same `SweepSettled` event). v2
signs one EIP-712 `SweepBatch` for every chain (domain `permission-2`, no chain id); v1
(`0x589C...3f70`, Base only, one signature per chain) is unused.

## ZeroDustSweep 3.0.0 (January 2026)

`src/ZeroDustSweepMainnet.sol`, `0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2` (CREATE2, same address on
every chain), deployed on the 52 chains the API serves. EIP-712 domain `ZeroDust`, version `3`, with
the user's EOA as `verifyingContract` (the contract runs as the wallet under EIP-7702).

- One signed structure, `SweepIntent` (14 fields), one function, `sweep(intent, userSig, callData)`, sponsor only (up to 3 sponsors fixed at deploy; deployed with one, the KMS key); `mode` 0 transfers
  on the same chain, `mode` 1 calls a bridge (`callTarget` + `callData`, bound by
  `routeHash = keccak256(callData)`).
- Fees: `maxTotalFeeWei` caps the whole reserve; gas reimbursement from `overheadGasUnits` and the
  measured gas at no more than `reimbGasPriceCapWei`; the service fee and L1 data fees in
  `extraFeeWei`. `protocolFeeGasUnits` is unused (always 0).
- Exactly-zero post-condition, ERC-7201 namespaced nonce storage, low-s signatures, explicit
  reentrancy guard, sponsors fixed in the bytecode, no admin functions.

`src/ZeroDustSweepTEST.sol` is an older testnet copy, not deployed by any current script.
