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

All chains with EIP-7702 support:

| Chain | Native Token | Status |
|-------|--------------|--------|
| BSC | BNB | **Mainnet** |
| Polygon | POL | **Mainnet** |
| Arbitrum | ETH | **Mainnet** |
| Base | ETH | **Mainnet** |
| + 46 testnets | Various | Testnet |

See [contracts/README.md](./contracts/README.md) for full deployment list.

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

**Smart Contract:** V3 deployed on 4 mainnets + 46 testnets

### Contract Versions

| Version | Status | Features |
|---------|--------|----------|
| V3 (ZeroDustSweepMainnet) | **Mainnet** | Unified SweepIntent, granular fees, sponsor model |
| V3 (ZeroDustSweepV3TEST) | Testnet | Same as mainnet, for testing |

### Mainnet Deployments (V3)

| Chain | Chain ID | Status |
|-------|----------|--------|
| BSC | 56 | Deployed |
| Polygon | 137 | Deployed |
| Arbitrum | 42161 | Deployed |
| Base | 8453 | Deployed |

See [contracts/README.md](./contracts/README.md) for contract addresses.

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

**Production deployed on BSC, Polygon, Arbitrum, and Base.**
