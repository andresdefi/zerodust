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
4. ZeroDust sponsor executes the sweep
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

**Contract Address (same on all chains):** `0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2`

V3 is deployed on **26 mainnet chains** with EIP-7702 support:

| Chain | ID | Token | Chain | ID | Token |
|-------|---:|-------|-------|---:|-------|
| Ethereum | 1 | ETH | Sei | 1329 | SEI |
| Optimism | 10 | ETH | Astar zkEVM | 1514 | ETH |
| BSC | 56 | BNB | Soneium | 1868 | ETH |
| Gnosis | 100 | xDAI | Mantle | 5000 | MNT |
| Unichain | 130 | ETH | Kaia | 5330 | KAIA |
| Polygon | 137 | POL | Base | 8453 | ETH |
| Sonic | 146 | S | Plasma | 9745 | XPL |
| X Layer | 196 | OKB | ApeChain | 33139 | APE |
| Fraxtal | 252 | frxETH | Mode | 34443 | ETH |
| World Chain | 480 | ETH | Arbitrum | 42161 | ETH |
| Celo | 42220 | CELO | Redstone | 57073 | ETH |
| BOB | 60808 | ETH | Berachain | 80094 | BERA |
| Scroll | 534352 | ETH | Zora | 7777777 | ETH |

Plus **46 testnets** for development.

See [contracts/README.md](./contracts/README.md) for explorer links.

## Project Structure

```
zerodust/
├── contracts/          # Smart contracts (Foundry)
│   ├── src/
│   │   ├── ZeroDustSweepMainnet.sol   # V3 production contract
│   │   └── ZeroDustSweepV3TEST.sol    # V3 testnet contract
│   ├── script/
│   │   ├── DeployMainnet.s.sol        # Mainnet deployment
│   │   └── DeployV3.s.sol             # Testnet deployment
│   └── broadcast/                      # Deployment logs
└── docs/
```

## Architecture

### V3 Contract Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User's EOA                            │
│                   (EIP-7702 delegated)                       │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │          ZeroDustSweepMainnet (bytecode)             │    │
│  │                                                      │    │
│  │              executeSweep(intent, sig)               │    │
│  │                        │                             │    │
│  │           ┌────────────┴────────────┐                │    │
│  │           ▼                         ▼                │    │
│  │    MODE_TRANSFER (0)         MODE_CALL (1)           │    │
│  │    Same-chain sweep          Cross-chain sweep       │    │
│  │           │                         │                │    │
│  │           ▼                         ▼                │    │
│  │    Transfer to              Call bridge target       │    │
│  │    destination              (callTarget + callData)  │    │
│  │                                     │                │    │
│  └─────────────────────────────────────┼────────────────┘    │
│                                        │                     │
└────────────────────────────────────────┼─────────────────────┘
                                         │
                                         ▼
                          ┌─────────────────────────┐
                          │     External Bridge     │
                          │       (Gas.zip)         │
                          │                         │
                          │   Delivers funds on     │
                          │   destination chain     │
                          └─────────────────────────┘
```

### Security Model

- **No admin functions** - Immutable after deployment
- **No upgradability** - What you see is what you get
- **Unified SweepIntent** - Single signed structure for all sweep types
- **Zero balance enforcement** - Contract reverts if any balance remains
- **ERC-7201 storage** - Prevents slot collisions with other EIP-7702 apps
- **Immutable sponsors** - Stored in bytecode, not storage

## Fee Structure

**Service Fee:** 5% of swept value, with $0.05 minimum and $0.50 maximum.

```
Total Fee = Gas Reimbursement + Service Fee + Bridge Fee (if cross-chain)

Examples:
- $2 balance → $0.10 fee (5%) → User receives ~$1.90
- $1 balance → $0.05 fee (min) → User receives ~$0.95
- $15 balance → $0.50 fee (max) → User receives ~$14.50
```

## Documentation

- [contracts/README.md](./contracts/README.md) - Contract details and deployment
- [contracts/V3_SPECIFICATION.md](./contracts/V3_SPECIFICATION.md) - V3 technical specification
- [contracts/V3_DEPLOYMENT.md](./contracts/V3_DEPLOYMENT.md) - Deployment guide

## Security

ZeroDust is designed with security as the top priority:

- **No fund custody** - All operations are atomic, single-transaction
- **User-controlled limits** - maxTotalFeeWei and minReceive signed by user
- **Mandatory simulation** - Every transaction simulated before execution
- **routeHash binding** - Signature bound to specific bridge route (cross-chain)
- **Internal security review** - 7 rounds, 16 issues identified and fixed
- **External audit** - Pending (required before full launch)

## Status

**Smart Contract:** V3 deployed on **26 mainnets** + 46 testnets

### Contract Versions

| Version | Status | Features |
|---------|--------|----------|
| V3 (ZeroDustSweepMainnet) | **Production** | Unified SweepIntent, granular fees, sponsor model |
| V3 (ZeroDustSweepV3TEST) | Testnet | Same as mainnet, for testing |

### Verified Mainnet Sweeps

| Chain | Swept | TX |
|-------|-------|-----|
| Base | $3.46 → 0 | [View](https://basescan.org/tx/0x2f59a4598c7fcdce404c2330d361fda1cbab84b841e85bec82ca12164101b73d) |
| Arbitrum | $3.57 → 0 | [View](https://arbiscan.io/tx/0xffa0a26008157b0225a7c15c2263b80b6e386520dce69b58827320ced0dc5c62) |
| BSC | $2.25 → 0 | [View](https://bscscan.com/tx/0xc94f52c8689268118e3d42dd678916982b5479adb0e69227ddd1c3142ea52972) |
| Polygon | $7.55 → 0 | [View](https://polygonscan.com/tx/0xc21c4c29dbe1624c06a2a9a7692ac68409f3407f0c1960f01100ef39ceeb369f) |

See [contracts/README.md](./contracts/README.md) for full deployment list.

### Testnets NOT Supporting EIP-7702

The following testnets were tested and do not support EIP-7702:

Abstract, Lens, zkSync, Taiko, opBNB, Avalanche, Swell, Cyber, Boba, Metis, Fuse, Aurora, Flare, Vana, Corn, Rootstock, Apechain, IoTeX, Viction, XDC, Telos, Kava, EDU Chain, Gravity, Manta Pacific, Lightlink, Moonbase, Nibiru, Somnia, Rari, Blast, Xai, B3, Mezo, Chiliz, HashKey, Memecore

*Note: Mainnet support may differ from testnet.*

## Cross-Chain Bridging

ZeroDust V3 supports cross-chain sweeps via the MODE_CALL pattern:

- **callTarget**: Bridge contract address
- **callData**: Bridge-specific transaction data
- **routeHash**: `keccak256(callData)` - binds signature to specific route

**Primary Bridge:** [Gas.zip](https://gas.zip) - 239+ chains, ~5 second delivery

## License

MIT License - see [LICENSE](./LICENSE)

---

**Production deployed on 26 mainnet chains.** Contract: `0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2`
