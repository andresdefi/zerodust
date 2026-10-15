# ZeroDust Smart Contracts

Smart contracts for ZeroDust - an intent-based exit system for sweeping native gas tokens to exactly zero via EIP-7702.

## Overview

ZeroDust enables users to sweep their entire native token balance from any EIP-7702-compatible chain. The sponsor (relayer) executes sweeps on behalf of users, paying gas costs and receiving reimbursement from the swept funds.

**Key Features:**
- Sweep native tokens to exactly 0 balance
- Single unified `SweepIntent` structure for all sweep types
- EIP-7702 sponsored execution (user pays no gas directly)
- Same-chain transfers (MODE_TRANSFER) and cross-chain bridges (MODE_CALL)
- Transparent, granular fee structure
- ERC-7201 namespaced storage for nonce isolation

## Contracts

### ZeroDustSweepMainnet.sol (Production)

Production contract for mainnet deployments.

**Features:**
- Unified `SweepIntent` with 14 fields
- Mode-based execution (0 = transfer, 1 = call)
- Generic `callTarget + callData` pattern for bridges
- Granular fee breakdown (overhead, protocol, extra, gas cap)
- Immutable sponsor addresses
- EIP-712 signatures with user's EOA as verifyingContract

### ZeroDustPermissionRouter.sol (MetaMask without a key)

`0x369A97dd256F7eb37fF7116C4EcBd50318eBb286` (v2, CREATE2, `script/DeployPermissionRouter.s.sol`).
Redeems a MetaMask Advanced Permission (ERC-7715, a one-time `native-token-allowance` with the router
as redeemer and payee) through MetaMask's DelegationManager, requires the wallet to end at exactly 0,
then settles like the sweep contract and emits its `SweepSettled` event. One EIP-712 `SweepBatch`
(domain `ZeroDust` / `permission-2`, no chain id) covers every chain. Sponsor only; no storage
beyond per-user nonces; the router never holds funds between calls.

### ZeroDustGuard.yul (direct sweeps on OP-stack chains with an L1 fee)

`0x2f95e6ED90a7dD67fc3Fae5c5628647E6A83e48e` (CREATE2). A wallet without EIP-7702 sends one legacy
transaction `sweep(target, fee, data)` with value = balance - gas x price - L1 fee. The guard reverts
unless the wallet is then at exactly 0, pays `fee` to ZeroDust, forwards the rest, reverts if anything
came back, and burns the gas left so nothing is refunded. No owner, no storage. Header comment in the
file has the selector and error codes.

### ZeroDustSweepTEST.sol

An older copy for testnets; not deployed by any current script and not used by the tests.

## Architecture

### SweepIntent Structure

```solidity
struct SweepIntent {
    uint8 mode;                    // 0 = transfer, 1 = call
    address user;                  // User's EOA being swept
    address destination;           // Where funds go (same-chain) or callTarget (cross-chain)
    uint256 destinationChainId;    // Target chain (same as source for same-chain)
    address callTarget;            // Bridge contract (MODE_CALL only)
    bytes32 routeHash;             // keccak256(callData) - binds signature to route
    uint256 minReceive;            // Minimum user receives
    uint256 maxTotalFeeWei;        // Hard cap on total fees
    uint256 overheadGasUnits;      // Gas overhead (50k-300k)
    uint256 protocolFeeGasUnits;   // DEPRECATED - use extraFeeWei
    uint256 extraFeeWei;           // Service fee (5% under $1; else 1%, $0.05 min, $0.50 max)
    uint256 reimbGasPriceCapWei;   // Gas price cap for reimbursement
    uint256 deadline;              // Signature expiration (unix timestamp)
    uint256 nonce;                 // Per-user nonce
}
```

### Fee Structure

**Service Fee:** 1% of swept value, with $0.05 minimum and $0.50 maximum; balances under $1 pay 5% with no minimum.

```
Total Fee = Gas Reimbursement + Service Fee + Bridge Fee (if cross-chain)

Where:
- Gas Reimbursement = (overheadGasUnits) × reimbGasPriceCapWei
- Service Fee = min(max(balance × 1%, $0.05), $0.50) → goes in extraFeeWei
- Bridge Fee = Destination chain gas (cross-chain only)
```

### EIP-712 Domain

ZeroDust uses the user's EOA as the `verifyingContract` (EIP-7702 requirement):

```solidity
{
    name: "ZeroDust",
    version: "3",
    chainId: <chain_id>,
    verifyingContract: <user_address>  // User's EOA, not contract
}
```

## Deployments

### ZeroDustSweep

**Address (same on all chains):** `0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2`, deployed with `script/DeployMainnet.s.sol` through the
CREATE2 factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`. Sponsor: the AWS KMS key
`0x01eD5c94DE39E73C986b98B85C2c0A3d1BEDff7D`, fixed in the bytecode. The 57 chains the API serves
(generated from `GET https://api.zerodust.xyz/chains` on 2026-10-15):

| Chain | Chain ID | Native Token | Explorer |
|-------|----------|--------------|----------|
| Ethereum | 1 | ETH | [View](https://etherscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Optimism | 10 | ETH | [View](https://optimistic.etherscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| BNB Chain | 56 | BNB | [View](https://bscscan.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Gnosis | 100 | xDAI | [View](https://gnosisscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Unichain | 130 | ETH | [View](https://uniscan.xyz/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Polygon | 137 | POL | [View](https://polygonscan.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Sonic | 146 | S | [View](https://sonicscan.org/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Manta Pacific | 169 | ETH | [View](https://pacific-explorer.manta.network/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| X Layer | 196 | OKB | [View](https://www.okx.com/web3/explorer/xlayer/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Fraxtal | 252 | FRAX | [View](https://fraxscan.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Shape | 360 | ETH | [View](https://shapescan.xyz/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| World Chain | 480 | ETH | [View](https://worldscan.org/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Endurance | 648 | ACE | [View](https://explorer-endurance.fusionist.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Stable | 988 | gUSDT | [View](https://stablescan.xyz/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Lisk | 1135 | ETH | [View](https://blockscout.lisk.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Intuition | 1155 | TRUST | [View](https://explorer.intuition.systems/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Sei | 1329 | SEI | [View](https://seitrace.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| DATA Network | 1514 | DATA | [View](https://www.datanetscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Pharos | 1672 | PROS | [View](https://pharos.socialscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Reya | 1729 | ETH | [View](https://explorer.reya.network/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Metal L2 | 1750 | ETH | [View](https://explorer.metall2.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Soneium | 1868 | ETH | [View](https://explorer.soneium.org/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Ronin | 2020 | RON | [View](https://app.roninchain.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Morph | 2818 | ETH | [View](https://explorer.morphl2.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| RISE | 4153 | ETH | [View](https://explorer.risechain.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| MegaETH | 4326 | ETH | [View](https://mega.etherscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Robinhood Chain | 4663 | ETH | [View](https://robin.etherscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Mantle | 5000 | MNT | [View](https://mantlescan.xyz/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Somnia | 5031 | SOMI | [View](https://explorer.somnia.network/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Arc | 5042 | USDC | [View](https://explorer.arc.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Superseed | 5330 | ETH | [View](https://explorer.superseed.xyz/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Kaia | 8217 | KAIA | [View](https://kaiascan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Base | 8453 | ETH | [View](https://basescan.org/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Plasma | 9745 | XPL | [View](https://explorer.plasma.to/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| 0G | 16661 | 0G | [View](https://chainscan.0g.ai/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Apechain | 33139 | APE | [View](https://apechain.calderaexplorer.xyz/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Mode | 34443 | ETH | [View](https://explorer.mode.network/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Mythos | 42018 | ETH | [View](https://mythos-mainnet.explorer.alchemy.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Arbitrum | 42161 | ETH | [View](https://arbiscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Arbitrum Nova | 42170 | ETH | [View](https://nova.arbiscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Celo | 42220 | CELO | [View](https://celoscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Hemi | 43111 | ETH | [View](https://explorer.hemi.xyz/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Zircuit | 48900 | ETH | [View](https://explorer.zircuit.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Ink | 57073 | ETH | [View](https://explorer.inkonchain.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Linea | 59144 | ETH | [View](https://lineascan.build/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| BOB | 60808 | ETH | [View](https://explorer.gobob.xyz/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Berachain | 80094 | BERA | [View](https://beratrail.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Codex | 81224 | ETH | [View](https://explorer.codex.xyz/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Doma | 97477 | ETH | [View](https://explorer.doma.xyz/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Plume | 98866 | PLUME | [View](https://explorer.plume.org/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Mitosis | 124816 | MITO | [View](https://mitoscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Taiko | 167000 | ETH | [View](https://taikoscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| HPP | 190415 | ETH | [View](https://explorer.hpp.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Scroll | 534352 | ETH | [View](https://scrollscan.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Gensyn | 685689 | ETH | [View](https://gensyn-mainnet.explorer.alchemy.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Katana | 747474 | ETH | [View](https://katanascan.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Zora | 7777777 | ETH | [View](https://explorer.zora.energy/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |

### ZeroDustPermissionRouter v2

`0x369A97dd256F7eb37fF7116C4EcBd50318eBb286` on 16 chains: Ethereum, Optimism, BNB Chain, Gnosis, Unichain, Polygon, Sonic, Robinhood Chain, Mantle, Arc, Base, Arbitrum, Celo, Linea, Berachain, Katana.

### ZeroDustGuard

`0x2f95e6ED90a7dD67fc3Fae5c5628647E6A83e48e` on Blast (81457) and Boba (288).

## Development

```bash
forge install
forge build
forge test        # CI pins forge 1.7.1 (1.8.5 reports 0 gas for pranked calls in the guard's gas tests)
```

Deploy (see [DEPLOYMENT.md](./DEPLOYMENT.md)):

```bash
forge script script/DeployMainnet.s.sol:DeployMainnet --rpc-url $RPC_URL --broadcast
forge script script/DeployPermissionRouter.s.sol --rpc-url $RPC_URL --broadcast
```

## Chain notes

- **BNB Chain**: `baseFeePerGas` is 0, so Foundry's `cast` cannot build type-4 transactions; use viem.
- **Ronin**: Foundry's gas estimates misbehave; use viem with explicit gas.
- **Chains without the CREATE2 factory** would need a CREATE deploy at another address; none of the
  live chains does.
- **Chains without EIP-7702** (Avalanche, zkSync Era, Abstract, Lens, Blast, Boba, Metis, Monad's
  reserve rule and others) are swept as direct chains: the API plans exact legacy transactions
  instead (`GET https://api.zerodust.xyz/direct/chains`).

## Security

- ERC-7201 namespaced storage (no slot collisions with other EIP-7702 apps)
- Low-s signature malleability protection
- Exactly-zero post-condition
- Sponsor addresses immutable (in the bytecode)
- Checks-effects-interactions, explicit reentrancy guard
- No admin functions, no upgrades

Internal security review complete ([SECURITY.md](./SECURITY.md), [SECURITY_REPORT.md](./SECURITY_REPORT.md)).
Not externally audited; no audit is currently funded.

## Files

```
contracts/
├── src/
│   ├── ZeroDustSweepMainnet.sol       # the sweep contract
│   ├── ZeroDustPermissionRouter.sol   # MetaMask permission sweeps
│   ├── ZeroDustGuard.yul              # exact-zero direct sweeps on OP-stack chains
│   └── ZeroDustSweepTEST.sol          # old testnet copy, unused
├── script/                            # DeployMainnet, DeployPermissionRouter, verify scripts, e2e
├── test/                              # Foundry tests (sweep, router incl. fork tests, guard)
├── broadcast/                         # deployment logs by chain
├── DEPLOYMENT.md, SPECIFICATION.md, SECURITY.md, SECURITY_REPORT.md, CHANGELOG.md
└── foundry.toml
```

## License

MIT
