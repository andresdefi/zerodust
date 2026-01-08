# ZeroDust

**Exit a blockchain completely - transfer 100% of your native gas balance via EIP-7702**

ZeroDust is an intent-based exit system that enables users to sweep their entire native gas token balance to exactly zero via EIP-7702 sponsored execution.

## The Problem

When users want to fully exit a blockchain, they face an impossible situation:

```
User has: 0.0008 ETH on Arbitrum
User wants: 0 ETH on Arbitrum (transfer everything to Base)

The Problem:
├── To send ETH, you need ETH for gas
├── If you send all your ETH, you can't pay gas
├── If you keep gas, you can't send all your ETH
└── Result: Small amount always stranded
```

**ZeroDust is the only solution that enables complete chain exits for native gas tokens.**

## How It Works

1. User connects wallet to ZeroDust
2. User selects source chain and destination (same-chain or cross-chain)
3. User signs ONE authorization (no gas needed)
4. ZeroDust relayer executes the sweep
5. User receives funds on destination
6. **Origin chain balance: EXACTLY ZERO**

## Supported Sweep Cases

| Case | Description | Example |
|------|-------------|---------|
| Cross-chain, same address | Exit to yourself on another chain | Arbitrum → Base (same wallet) |
| Cross-chain, different address | Exit to another wallet on another chain | Arbitrum → Base (different wallet) |
| Same-chain, different address | Consolidate to another wallet | Arbitrum → Arbitrum (different wallet) |

**Post-Condition (enforced on-chain):** Source balance = exactly 0 wei

## Supported Chains

All chains with EIP-7702 support (44 testnets verified, mainnets pending):

| Chain | Native Token | Status |
|-------|--------------|--------|
| Ethereum | ETH | Testnet |
| Arbitrum | ETH | Testnet |
| Optimism | ETH | Testnet |
| Base | ETH | Testnet |
| Polygon | POL | Testnet |
| BSC | BNB | Testnet |
| Gnosis | xDAI | Testnet |
| + 37 more | Various | Testnet |

See [contracts/README.md](./contracts/README.md) for full deployment list.

## Project Structure

```
zerodust/
├── contracts/          # Smart contracts (Foundry)
│   ├── src/
│   │   ├── ZeroDustSweep.sol      # V1 (same-chain)
│   │   ├── ZeroDustSweepV2.sol    # V2 (cross-chain) - NEW
│   │   ├── interfaces/
│   │   │   └── IZeroDustAdapter.sol
│   │   └── adapters/
│   │       └── BungeeAdapter.sol   # Bungee Auto integration
│   └── test/
└── docs/
```

**Related Repositories:**
- [zerodust-backend](https://github.com/zerodustxyz/zerodust-backend) (private) - API & Relayer service

## Architecture

### V2 Contract Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User's EOA                            │
│                   (EIP-7702 delegated)                       │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              ZeroDustSweepV2 (bytecode)              │    │
│  │                                                      │    │
│  │  executeSameChainSweep()  executeCrossChainSweep()  │    │
│  │          │                        │                  │    │
│  │          ▼                        ▼                  │    │
│  │    Transfer to            Call Adapter               │    │
│  │    destination            (via interface)            │    │
│  │                                  │                   │    │
│  └──────────────────────────────────┼───────────────────┘    │
│                                     │                        │
└─────────────────────────────────────┼────────────────────────┘
                                      │
                                      ▼
                        ┌─────────────────────────┐
                        │     BungeeAdapter       │
                        │                         │
                        │  executeNativeBridge()  │
                        │          │              │
                        └──────────┼──────────────┘
                                   │
                                   ▼
                        ┌─────────────────────────┐
                        │     BungeeInbox         │
                        │  (Solver Auction)       │
                        │                         │
                        │  Delivers funds on      │
                        │  destination chain      │
                        └─────────────────────────┘
```

### Security Model

- **No admin functions** - Immutable after deployment
- **No upgradability** - What you see is what you get
- **Semantic parameters** - User signs destination, minReceive (not opaque calldata)
- **Zero balance enforcement** - Contract reverts if any balance remains
- **ERC-7201 storage** - Prevents slot collisions with other EIP-7702 apps
- **Immutable adapter allowlist** - Stored in bytecode, not storage

## Documentation

- [contracts/README.md](./contracts/README.md) - Contract details and deployment
- [contracts/CHANGELOG.md](./contracts/CHANGELOG.md) - V2 changes and security fixes

## Security

ZeroDust is designed with security as the top priority:

- **No fund custody** - All operations are atomic, single-transaction
- **User-controlled limits** - maxRelayerFee and minReceive signed by user
- **Mandatory simulation** - Every transaction simulated before execution
- **7 rounds of security review** - 16 issues identified and fixed in V2
- **Audit planned** - Via Optimism/Arbitrum grant programs

## Status

**Milestone 1: Smart Contract - COMPLETE**

| Milestone | Status | Description |
|-----------|--------|-------------|
| M1: Smart Contract | ✅ Complete | V1 deployed on 44 testnets, V2 ready |
| M2: Backend/Relayer | 🔜 Next | API structure ready, relayer pending |
| M3: SDK | ⏳ Pending | TypeScript SDK for integrators |
| M4: Frontend | ⏳ Pending | Web application |
| M5: Testing & QA | ⏳ Pending | Integration testing |
| M6: Audit & Launch | ⏳ Pending | External audit, mainnet launch |

### Contract Progress

| Version | Status | Features |
|---------|--------|----------|
| V1 (ZeroDustSweep) | Deployed (44 testnets) | Same-chain sweeps |
| V2 (ZeroDustSweepV2) | Ready | Cross-chain via adapters, enhanced security |
| BungeeAdapter | Ready | Bungee Auto integration |

### Testnet Deployments (V1)

**Contract Address:** `0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC`

- 44 testnets deployed and E2E verified
- 36 chains confirmed NOT supporting EIP-7702
- 80 chains tested total

See [contracts/README.md](./contracts/README.md) for full list.

### Chains NOT Supporting EIP-7702

Abstract, Lens, MegaETH, opBNB, Avalanche, Swell, Cyber, Boba, Metis, Fuse, Aurora, Flare, Vana, Corn, Rootstock, Apechain, IoTeX, Viction, XDC, Telos, Kava, EDU Chain, Gravity, Manta Pacific, Lightlink, Moonbase, Nibiru, Somnia, Rari, Blast, Xai, B3, Mezo, Chiliz, HashKey, Memecore

## Bridge Integration

### Bungee Auto (First Integration)

ZeroDust uses Bungee Auto for cross-chain bridging:

- **Auction-based routing** - Solvers compete to fulfill requests
- **Competitive pricing** - Best execution through competition
- **Simple UX** - Users don't need to select bridges

**Supported Bungee Chains (Mainnet):**
Ethereum, Arbitrum, Base, Optimism, Polygon, BSC, + more

## License

MIT License - see [LICENSE](./LICENSE)

---

**Not yet ready for production use.**
