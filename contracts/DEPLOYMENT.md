# Deploying ZeroDust contracts

All contracts go through the CREATE2 factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`, so each
has one address on every chain. A chain without that factory would need a CREATE deploy at another
address (none of the live chains does). Every script checks the expected address first and does
nothing if the code is already there.

## ZeroDustSweep (`src/ZeroDustSweepMainnet.sol`)

`script/DeployMainnet.s.sol`, salt `0x5a65726f44757374` ("ZeroDust"), address
`0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2`.

Constructor (in the script): sponsors = `[SPONSOR_ADDRESS]` (the AWS KMS key
`0x01eD5c94DE39E73C986b98B85C2c0A3d1BEDff7D`), min/max overhead gas units 50,000 / 300,000, max
protocol-fee gas units 100,000, max extra fee 1000 ether (covers tokens as cheap as $0.00005 at the
$0.05 minimum fee), max reimbursement gas price cap 1000 gwei. These are part of the bytecode: any
change gives a different address. The sponsor must be an EOA.

```bash
PRIVATE_KEY=<deployer> SPONSOR_ADDRESS=0x01eD5c94DE39E73C986b98B85C2c0A3d1BEDff7D \
  forge script script/DeployMainnet.s.sol:DeployMainnet --rpc-url $RPC_URL --broadcast
```

The deployer is `0x16c9af121C797A56902170a7f808eDF1a857ED49` (it only pays for the deploy; it has no
role in the contract). `script/deploy-all-mainnets.sh` loops over chains with RPCs from the backend's
`.env`; `script/verify-all-mainnets.sh` verifies on the Etherscan-family explorers.

## ZeroDustPermissionRouter v2 (`src/ZeroDustPermissionRouter.sol`)

`script/DeployPermissionRouter.s.sol`, salt `keccak256("ZeroDust permission router v2")`, address
`0x369A97dd256F7eb37fF7116C4EcBd50318eBb286`. Same sponsor and fee bounds as the sweep contract, plus
MetaMask's DelegationManager (`0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`, the same on every chain).
Deploy it only where MetaMask offers Advanced Permissions; the backend turns a chain on once it finds
the router's code there.

## ZeroDustGuard (`src/ZeroDustGuard.yul`)

`0x2f95e6ED90a7dD67fc3Fae5c5628647E6A83e48e` on Blast and Boba, deployed through the same factory from
its Yul creation code. After a deploy, check the runtime code hash:
`0x0e00b07c95af7e18d655633d521d110ce6e95ff3c330ff3a4ac2d1b44fed685e`.

## ZeroDustPaymaster (ZK stack)

Lives in `../contracts-zk` (Hardhat + zksolc): `0x986e4Bb55AEEE6a8c80c28Ca787b13E216fD25B8` on zkSync
Era, Abstract and Lens. See its README.

## Source verification

- Etherscan family: `forge verify-contract` works.
- Sourcify: forge's Sourcify verifier still calls the removed v1 API and wrongly reports "already
  verified". Submit through v2: `POST https://sourcify.dev/server/v2/verify/{chainId}/{address}` with
  forge's `--show-standard-json-input`, compiler `0.8.28+commit.7893614a`, the contract identifier and
  the deploy transaction hash; then poll `GET /v2/verify/{verificationId}`.

## Before enabling a chain

A deployed contract is not a supported chain: EIP-7702 must work there (one real sweep, because some
chains accept type-4 transactions and never mine them), the sponsor needs a float, and the backend
needs the chain's config.
