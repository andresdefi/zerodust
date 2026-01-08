# ZeroDust Smart Contracts

Smart contracts for ZeroDust - an intent-based exit system for sweeping native gas tokens to exactly zero via EIP-7702.

## Contracts

### ZeroDustSweep.sol (V1)

The original sweep contract for same-chain transfers.

**Deployed Address:** `0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC` (44 testnets)

**Status:** Deployed on testnets, E2E verified. Will be superseded by V2 for mainnet.

### ZeroDustSweepV2.sol (V2) - NEW

Complete rewrite with cross-chain support and enhanced security. See [CHANGELOG.md](./CHANGELOG.md) for detailed changes.

**Deployed Address (Sepolia):** `0x873EA974fF6e0Dd68a5cA1db7eFfc4A0A781a32D`

**Status:** Deployed and E2E verified on Sepolia testnet (January 8, 2026)

**Key Improvements:**
- Cross-chain sweeps via bridge adapters (Bungee Auto)
- ERC-7201 namespaced storage (prevents slot collisions)
- Zero balance post-condition enforcement
- Low-s signature malleability protection
- Semantic parameters for bridge calls (user signs destination, minReceive)
- Immutable adapter allowlist (in bytecode, not storage)
- Separate same-chain vs cross-chain functions
- Custom errors for better debugging

**Supported Sweep Cases:**
1. Cross-chain, same address: `(chain A, addr U) → (chain B, addr U)`
2. Cross-chain, different address: `(chain A, addr U) → (chain B, addr V)`
3. Same-chain, different address: `(chain A, addr U) → (chain A, addr V)`

**Post-Condition (enforced):** Source balance = exactly 0 wei

### MockAdapter.sol - NEW (Testing Only)

Test adapter for E2E testing cross-chain flows without real bridge.

**Deployed Address (Sepolia):** `0xdd7Eb781200bA886cBE3c9C0ed80CE587c39724c`

### IZeroDustAdapter.sol - NEW

Interface for bridge adapters:

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

### BungeeAdapter.sol - NEW

Bridge adapter for Bungee Auto (auction-based cross-chain bridging).

**BungeeInbox Addresses (Mainnet):**

| Chain | Address |
|-------|---------|
| Ethereum | `0x92612711D4d07dEbe4964D4d1401D7d7B5a11737` |
| Arbitrum | `0xA3BF43451CdEb6DEC588B8833838fC419CE4F54c` |
| Base | `0x3C54883Ce0d86b3abB26A63744bEb853Ea99a403` |
| Optimism | `0x78255f1DeE074fb7084Ee124058A058dE0B1C251` |
| Polygon | `0xFEfFE1D89542C111845648a107811Fb272EaE0Da` |
| BSC | `0x002cd45978F556D817e5FBB4020f7Dd82Bb10941` |

## Development

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Node.js 18+ (for BSC/Ronin E2E tests)

### Setup

```bash
# Install dependencies
forge install

# Build
forge build

# Run tests
forge test

# Run tests with coverage
forge coverage

# Run extended fuzz tests (CI mode)
forge test --fuzz-runs 10000
```

### Test Coverage (V1)

```
| File                  | % Lines     | % Statements | % Branches  | % Funcs    |
|-----------------------|-------------|--------------|-------------|------------|
| src/ZeroDustSweep.sol | 100.00%     | 100.00%      | 100.00%     | 100.00%    |
```

## Deployment

### Deploy to a testnet

```bash
# Set environment variables
cp .env.example .env
# Edit .env with your private key

# Deploy to Sepolia
source .env && forge script script/Deploy.s.sol:Deploy \
    --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
    --broadcast \
    --verify
```

### V1 Deployed Testnets (44 chains)

**Standard Address:** `0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC`

| Chain | Chain ID | Explorer |
|-------|----------|----------|
| Sepolia | 11155111 | [View](https://sepolia.etherscan.io/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Base Sepolia | 84532 | [View](https://sepolia.basescan.org/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Arbitrum Sepolia | 421614 | [View](https://sepolia.arbiscan.io/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Optimism Sepolia | 11155420 | [View](https://sepolia-optimism.etherscan.io/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| BSC Testnet | 97 | [View](https://testnet.bscscan.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Polygon Amoy | 80002 | [View](https://amoy.polygonscan.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Gnosis Chiado | 10200 | [View](https://gnosis-chiado.blockscout.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Unichain Sepolia | 1301 | [View](https://sepolia.uniscan.xyz/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Berachain Bepolia | 80069 | [View](https://bepolia.beratrail.io/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Plasma Testnet | 9746 | [View](https://testnet-explorer.plasma.to/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Mantle Sepolia | 5003 | [View](https://sepolia.mantlescan.xyz/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Ink Sepolia | 763373 | [View](https://explorer-sepolia.inkonchain.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Mode Sepolia | 919 | [View](https://sepolia.explorer.mode.network/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Zora Sepolia | 999999999 | [View](https://sepolia.explorer.zora.energy/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Soneium Minato | 1946 | [View](https://explorer-testnet.soneium.org/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Metal L2 Testnet | 1740 | [View](https://testnet.explorer.metall2.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Lisk Sepolia | 4202 | [View](https://sepolia-blockscout.lisk.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| World Chain Sepolia | 4801 | [View](https://worldchain-sepolia.explorer.alchemy.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Sei Testnet | 1328 | [View](https://seitrace.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC?chain=atlantic-2) |
| Core Testnet | 1114 | [View](https://scan.test2.btcs.network/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Etherlink Shadownet | 127823 | [View](https://shadownet.explorer.etherlink.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Superposition Testnet | 98985 | [View](https://testnet-explorer.superposition.so/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Celo Sepolia | 11142220 | [View](https://celo-sepolia.blockscout.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Superseed Sepolia | 53302 | [View](https://sepolia-explorer.superseed.xyz/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| X Layer Testnet | 1952 | [View](https://www.okx.com/web3/explorer/xlayer-test/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Sonic Testnet | 14601 | [View](https://testnet.sonicscan.org/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Shape Sepolia | 11011 | [View](https://explorer-sepolia.shape.network/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Fraxtal Testnet | 2523 | [View](https://holesky.fraxscan.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Katana Bokuto | 737373 | [View](https://explorer-bokuto.katanarpc.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| BOB Sepolia | 808813 | [View](https://bob-sepolia.explorer.gobob.xyz/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Rise Testnet | 11155931 | [View](https://explorer.testnet.riselabs.xyz/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Flow EVM Testnet | 545 | [View](https://evm-testnet.flowscan.io/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Kaia Kairos | 1001 | [View](https://kairos.kaiascan.io/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Camp BaseCAMP | 123420001114 | [View](https://basecamp.cloud.blockscout.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Zircuit Garfield | 48898 | [View](https://explorer.garfield-testnet.zircuit.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Morph Hoodi | 2910 | [View](https://explorer-hoodi.morph.network/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Doma Testnet | 97476 | [View](https://explorer-testnet.doma.xyz/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| 0G Galileo | 16602 | [View](https://chainscan-galileo.0g.ai/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Stable Testnet | 2201 | [View](https://stable-testnet.blockscout.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Scroll Sepolia | 534351 | [View](https://sepolia.scrollscan.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Ancient8 Testnet | 28122024 | [View](https://scanv2-testnet.ancient8.gg/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Ronin Saigon | 2021 | [View](https://saigon-app.roninchain.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Settlus Sepolia | 5373 | [View](https://sepolia.settlus.network/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |

**Non-Standard Addresses:**

| Chain | Chain ID | Address | Reason |
|-------|----------|---------|--------|
| Cronos Testnet | 338 | `0xcdfd3214e3db77085a2956bf5976501d4723925e` | No standard CREATE2 factory |
| XRPL EVM Testnet | 1449000 | `0xF3971F50BDE29d5a763c42edDD1bb95D0f2F571A` | No standard CREATE2 factory |

## E2E Testing

### Run E2E tests on testnets

**For most chains:**
```bash
export USER_PRIVATE_KEY=0x...  # Test user wallet
export RELAYER_PRIVATE_KEY=0x...  # Relayer wallet with gas
export RPC_URL=https://ethereum-sepolia-rpc.publicnode.com

./script/e2e-test.sh
```

**For BSC/Ronin (requires viem):**
```bash
npm install
export PRIVATE_KEY=0x...  # Relayer wallet

node script/bsc-e2e-test.mjs
```

### Multi-chain E2E test
```bash
export PRIVATE_KEY=0x...
./script/e2e-all-chains.sh
```

## Chain-Specific Notes

### BSC & Ronin
Require `viem` instead of Foundry for EIP-7702 transactions due to gas estimation issues.

### Cronos & XRPL EVM
Different contract addresses due to missing standard CREATE2 factory.

### Flow EVM
High minimum gas price (16 gwei).

### 0G Galileo
High minimum gas price (3 gwei).

### Etherlink
Gas estimation ~3x off, use high gas limits.

## Security

### V2 Security Review
- 7 rounds of advisor review
- 16 security issues identified and fixed
- See [CHANGELOG.md](./CHANGELOG.md) for details

### Security Features
- ERC-7201 namespaced storage (prevents slot collisions)
- Low-s signature malleability protection
- Zero balance post-condition enforcement
- Immutable adapter allowlist
- Checks-Effects-Interactions pattern
- No reentrancy vulnerabilities
- No admin functions, no upgradability

### Audit Status
- Slither static analysis: Pending for V2
- Fuzz testing: In progress
- External audit: Pending (via Optimism/Arbitrum grants)

## Files

```
contracts/
├── src/
│   ├── ZeroDustSweep.sol           # V1 contract (same-chain only)
│   ├── ZeroDustSweepV2.sol         # V2 contract (cross-chain support)
│   ├── interfaces/
│   │   └── IZeroDustAdapter.sol    # Adapter interface
│   └── adapters/
│       └── BungeeAdapter.sol       # Bungee Auto adapter
├── test/
│   └── ZeroDustSweep.t.sol         # Test suite (V1)
├── script/
│   ├── Deploy.s.sol                # Deployment script
│   ├── e2e-test.sh                 # E2E test (cast-based)
│   ├── e2e-all-chains.sh           # Multi-chain E2E runner
│   └── bsc-e2e-test.mjs            # BSC E2E test (viem-based)
├── broadcast/                       # Deployment logs
├── foundry.toml                     # Foundry config
├── CHANGELOG.md                     # Detailed V2 changes
└── .env.example                     # Environment template
```

## License

MIT
