# ZeroDust Smart Contracts

Smart contracts for ZeroDust - an intent-based exit system for sweeping native gas tokens to exactly zero via EIP-7702.

## Contracts

### ZeroDustSweep.sol (V1)

The original sweep contract for same-chain transfers.

**Deployed Address:** `0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC` (49 testnets)

**Status:** Deployed on testnets, E2E verified. Will be superseded by V2 for mainnet.

### ZeroDustSweepV2.sol (V2) - NEW

Complete rewrite with cross-chain support and enhanced security. See [CHANGELOG.md](./CHANGELOG.md) for detailed changes.

**Latest Deployment (Sepolia with Real Cross-Chain):** `0xC55A663941140c81E53193f08B1Db50c9F116e5b`

**Status:** ✅ **ALL 3 SWEEP CASES VERIFIED** with real cross-chain bridging (January 8, 2026)

**Key Improvements:**
- Cross-chain sweeps via pluggable bridge adapters
- ERC-7201 namespaced storage (prevents slot collisions)
- Zero balance post-condition enforcement
- Low-s signature malleability protection
- Semantic parameters for bridge calls (user signs destination, minReceive)
- Immutable adapter allowlist (in bytecode, not storage)
- Separate same-chain vs cross-chain functions
- Custom errors for better debugging

**Supported Sweep Cases (All Verified ✅):**
1. Same-chain, different address: `(chain A, addr U) → (chain A, addr V)` ✅
2. Cross-chain, same address: `(chain A, addr U) → (chain B, addr U)` ✅
3. Cross-chain, different address: `(chain A, addr U) → (chain B, addr V)` ✅

**Post-Condition (enforced):** Source balance = exactly 0 wei

### OPStackAdapter.sol - NEW (Real Cross-Chain)

Bridge adapter for OP Stack native bridges (L1StandardBridge). Used for real cross-chain sweeps on testnets.

**Deployed Address (Sepolia → Base Sepolia):** `0x9C2f130060Ff97C948377C1eD93dBfac3581b56F`

### MockAdapter.sol - NEW (Testing Only)

Test adapter for E2E testing same-chain flows.

**Deployed Address (Sepolia):** `0x1575bfcA866807569B5260546C0Ac81912637f38`

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

### UniversalOPStackAdapter.sol - NEW (Testnet)

Single adapter supporting 15 OP Stack L2 destinations from Sepolia for testnet cross-chain sweeps.

**Deployed Address (Sepolia):** `0xC0773F9a0Ab3886b2c3C92bb12e2c1d76bea43da`

### Cross-Chain Bridge Integration (Mainnet)

For mainnet cross-chain sweeps, ZeroDust integrates with [Gas.zip](https://gas.zip):

| Feature | Details |
|---------|---------|
| Chains | 239+ supported |
| Speed | ~5 seconds |
| Fees | Near-zero (destination gas only) |
| Contract | `0x2a37D63EAdFe4b4682a3c28C1c2cD4F109Cc2762` |

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

### V1 Deployed Testnets (49 chains)

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
| Arc Testnet | 5042002 | `0xB4bFad3e876D8A10D2bc14a7e5A04a133714533F` | Different bytecode hash |
| Ethereal Testnet | 13374202 | `0xB4bFad3e876D8A10D2bc14a7e5A04a133714533F` | Different bytecode hash |
| Hemi Testnet | 743111 | `0xB4bFad3e876D8A10D2bc14a7e5A04a133714533F` | Different bytecode hash |
| Story Aeneid | 1315 | `0xB4bFad3e876D8A10D2bc14a7e5A04a133714533F` | Different bytecode hash |
| MegaETH Testnet | 6343 | `0x872230F37304F903f44B332e9A0ed7d31C1b55D7` | CREATE2 failed, deployed via CREATE |

## E2E Testing

### V2 Real Cross-Chain Test Results (January 8, 2026)

**All 3 sweep cases verified with real cross-chain bridging via OP Stack native bridge:**

| Case | Type | Source (Sepolia) | Destination | Final Source Balance | TX |
|------|------|------------------|-------------|---------------------|-----|
| 1 | Same-chain, diff addr | `0x4DBE...6f` | `0x16c9...49` (Sepolia) | **0 wei** ✅ | [View](https://sepolia.etherscan.io/tx/0xd8d73fbd308546af37e348bdbef8bca2d36681e8e0eac6728e7eb2573caea298) |
| 2 | Cross-chain, same addr | `0xf868...b8` | `0xf868...b8` (Base Sepolia) | **0 wei** ✅ | [View](https://sepolia.etherscan.io/tx/0x178dba09cdade71e0e9f4e8746180d3db96a143f71639f63adfdbf8679fd67b6) |
| 3 | Cross-chain, diff addr | `0x60cE...03` | `0x16c9...49` (Base Sepolia) | **0 wei** ✅ | [View](https://sepolia.etherscan.io/tx/0x6f62c72e4b871a65a87945aec3de1e9bdba6e7d41bb1507aef40dbfab4c1a210) |

**Cross-chain funds verified received on Base Sepolia:**
- Case 2: `0xf868718B8b06D2a97B92d11E43f9ABe7E23B9Db8` received 15,000,000,000,000 wei
- Case 3: `0x16c9af121C797A56902170a7f808eDF1a857ED49` received 15,000,000,000,000 wei

**V2 Deployed Contracts (Sepolia):**

| Contract | Address | Purpose |
|----------|---------|---------|
| ZeroDustSweepV2 | `0xC55A663941140c81E53193f08B1Db50c9F116e5b` | Main V2 contract |
| OPStackAdapter | `0x9C2f130060Ff97C948377C1eD93dBfac3581b56F` | Real bridge (Sepolia → Base Sepolia) |
| MockAdapter | `0x1575bfcA866807569B5260546C0Ac81912637f38` | Testing adapter |

### Run V2 E2E tests

**Real cross-chain (Sepolia → Base Sepolia):**
```bash
export RELAYER_PRIVATE_KEY=0x...
export SWEEP_V2_CONTRACT=0xC55A663941140c81E53193f08B1Db50c9F116e5b
export OP_STACK_ADAPTER=0x9C2f130060Ff97C948377C1eD93dBfac3581b56F

./script/e2e-test-real-crosschain.sh
```

### V1 E2E Testing (Same-Chain Only)

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

### Multi-chain E2E test (V1)
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

### Arc & Ethereal
Different bytecode hash produces alternate contract address. Arc uses USDC as native token, Ethereal uses USDe.

### Hemi
Different bytecode hash produces alternate contract address. Requires legacy gas pricing (`--legacy`) for deployments.

### Story
Different bytecode hash produces alternate contract address. Uses IP Token as native currency.

### MegaETH
CREATE2 deployment fails; deployed via regular CREATE. Uses ETH as native token.

## Testnets NOT Supporting EIP-7702

The following testnets were tested and confirmed to **not support EIP-7702** as of January 2026:

| Testnet | Reason |
|---------|--------|
| Abstract Testnet | ZKsync-based (uses native AA) |
| Lens Sepolia | ZKsync-based (uses native AA) |
| zkSync Sepolia | Transaction type not supported (uses native AA) |
| Taiko Hoodi | 0xef opcode not defined |
| opBNB Testnet | Not enabled |
| Avalanche Fuji | Not enabled |
| Swell Testnet | 0xef opcode not defined |
| Cyber Testnet | 0xef opcode not defined |
| Boba Sepolia | 0xef opcode not defined |
| Metis Hyperion | Transaction type not supported |
| Fuse Sparknet | EIP-7702 not enabled |
| Aurora Testnet | Method not supported (runs on NEAR) |
| Flare Coston2 | Transaction type not supported |
| Vana Moksha | Transaction type not supported |
| Corn Testnet | Transaction type not supported |
| Rootstock Testnet | Method not found |
| Apechain Curtis | Transaction type not supported |
| IoTeX Testnet | Transaction type not supported |
| Viction Testnet | RLP parsing error |
| XDC Apothem | Transaction type not supported |
| Telos EVM Testnet | Authorization list not supported |
| Kava Testnet | No EIP-1559/EIP-7702 support |
| EDU Chain Testnet | Transaction type not supported |
| Gravity Alpha Testnet | 0xef opcode not defined |
| Manta Pacific Testnet | 0xef opcode not defined |
| Lightlink Pegasus | Transaction type not supported |
| Moonbase Alpha | Broken EIP-7702 implementation |
| Injective Testnet | Broken EIP-7702 - authorizationList not processed |
| Nibiru Testnet | Transaction type not supported |
| Somnia Testnet | Invalid transaction |
| Rari Testnet | Unsupported transaction type |
| Blast Sepolia | Transaction type not supported |
| Xai Testnet | 0xef opcode not defined |
| B3 Sepolia | 0xef opcode not defined |
| Mezo Testnet | Transaction type not supported |
| Chiliz Spicy | Transaction type not supported |
| HashKey Testnet | 0xef opcode not defined |
| Horizen Testnet | 0xef opcode not defined |
| Harmony Testnet | Not implemented (no EIP-1559 support) |
| Memecore Testnet | Transaction type not supported |

**Note:** Mainnet EIP-7702 support may differ from testnet. This list reflects testnet status only.

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
│       ├── OPStackAdapter.sol      # OP Stack native bridge adapter
│       └── MockAdapter.sol         # Testing adapter
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
