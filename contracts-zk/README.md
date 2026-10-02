# ZeroDust paymaster (ZK-stack chains)

`contracts/ZeroDustPaymaster.sol` pays the gas of ZeroDust sweeps on ZK-stack chains (zkSync Era,
Abstract, Lens, Sophon), so a wallet sends its whole balance and ends at exactly 0. Design and the
protocol facts it relies on: `docs/ZK-PAYMASTER.md` in the workspace.

A sweep is two type-113 transactions naming the paymaster: a fee transaction to the paymaster
(service fee + the gas of both) and the sweep (the rest). Both carry an approval signed by the
backend over `(from, nonce, to, value, keccak(data), maxGasCost)` in the EIP-712 domain
`ZeroDust Paymaster` / `1`; the paymaster input is `general(abi.encode(maxGasCost, signature))`.
The sweep is paid only from credit left by that wallet's fee transaction.

## Build and test

Hardhat 2 and its zksync plugins do not run on Node 25, so commands go through Node 22 with npx;
zksolc is the release binary in `bin/` (the plugin's downloader fails there too):

```bash
npm ci
mkdir -p bin && gh release download 1.5.18 -R matter-labs/era-compiler-solidity \
  -p "zksolc-macosx-arm64-v1.5.18" -D bin && chmod +x bin/zksolc-macosx-arm64-v1.5.18
npx -y -p node@22 node node_modules/hardhat/internal/cli/bootstrap.js test --network hardhat
```

Tests run on a local anvil-zksync node the plugin starts: the wallet ends at exactly 0 wei, every
refusal names its rule, and only the owner can change the approver or withdraw.
