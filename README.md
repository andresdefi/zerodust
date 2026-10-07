# ZeroDust

**Exit a blockchain completely - transfer 100% of your native gas balance via EIP-7702**

ZeroDust is an intent-based exit system that enables users to sweep their entire native gas token balance to exactly zero via EIP-7702 sponsored execution.

## For AI agents

Agents accumulate dust as a byproduct of existing. Anything doing multi-chain
work — arbitrage, bridging, testing, deployment — ends up with stranded gas on
chains it will never touch again. A human notices and shrugs; an unattended
agent leaks capital indefinitely.

### Look first, no install, no key

The hosted MCP server needs nothing installed. Point any MCP client at:

```
https://api.zerodust.xyz/mcp
```

That is enough to find out whether an address has anything stranded and what
recovering it would cost. It is read-only, because it holds no keys.

### Then sweep, with the key wherever you keep it

```json
{
  "mcpServers": {
    "zerodust": {
      "command": "npx",
      "args": ["@zerodust/mcp-server"],
      "env": {
        "ZERODUST_ALLOW_EXECUTE": "true",
        "ZERODUST_SIGNER_MODULE": "./my-signer.mjs"
      }
    }
  }
}
```

Read-only by default. Sweeping needs the explicit opt-in above plus a signing
key, and there are four ways to supply one so a raw key never has to sit in a
config file:

| Variable | Key lives in |
|----------|--------------|
| `ZERODUST_SIGNER_MODULE` | your custody provider — any module returning a viem `LocalAccount`, which is what Turnkey, Privy and KMS adapters produce |
| `ZERODUST_KEYSTORE_FILE` | an encrypted V3 keystore, with the password in a separate file |
| `ZERODUST_PRIVATE_KEY_FILE` | a file on disk, not in the config |
| `ZERODUST_PRIVATE_KEY` | the config (simplest, least private) |

Funds can only go to the agent's own address unless
`ZERODUST_ALLOWED_DESTINATIONS` says otherwise — so a prompt-injected agent still
cannot send funds somewhere you never approved.

### Try it without risking anything

Every sweep tool and every SDK sweep accepts `dryRun`. It fetches a real quote,
produces all three real signatures, and stops before submitting. Nothing is
broadcast and no balance moves:

> "Do a dry run of sweeping my Arbitrum balance to Base"

There is deliberately no testnet mode: the API serves no testnet chains, so a
testnet flag would only return empty chain lists and failing quotes. `dryRun`
gives the same confidence against production.

### Agents can provision their own credentials

The read-only tools work with no credential at all. For higher limits an agent
can issue itself a key with no human in the loop, via the `zerodust_register_api_key`
tool or directly:

```bash
curl -X POST https://api.zerodust.xyz/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent", "agentId": "my-agent-1"}'
# -> { "apiKey": "zd_...", "rateLimits": { "perMinute": 300, "daily": 1000 } }
```

| Package | Use |
|---------|-----|
| [`@zerodust/mcp-server`](https://www.npmjs.com/package/@zerodust/mcp-server) | MCP (Claude Code, Claude Desktop, any MCP client) |
| [`@zerodust/sdk`](https://www.npmjs.com/package/@zerodust/sdk) | TypeScript, direct — `createAgentFromPrivateKey` |
| [`@zerodust/langchain`](https://www.npmjs.com/package/@zerodust/langchain) | LangChain tools |
| [`@zerodust/ai-sdk`](https://www.npmjs.com/package/@zerodust/ai-sdk) | Vercel AI SDK tools |

**Verified on mainnet** (2026-07-21): Optimism → Base, source balance to exactly
0, delegation auto-revoked, 99.88% delivered, 23.2s end to end —
[`0x19456ea8…`](https://optimistic.etherscan.io/tx/0x19456ea86ed91097847ddad6d6b8cfd6a5240dedac3b100d1a06eb64c86def6c).

> **Note on wallets:** the browser UI needs the non-standard
> `wallet_signAuthorization` RPC, which no shipping wallet exposes yet
> ([MetaMask #7836](https://github.com/MetaMask/core/pull/7836),
> [Rabby #3411](https://github.com/RabbyHub/Rabby/pull/3411)). Agents are
> unaffected — they hold their own keys and sign locally.

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

The contract is deployed on 52 mainnets, all live in the API. Sweeps can be sent
to any EVM chain a bridge (Gas.zip, Relay, Across) delivers native gas to, not
only these: `GET /destinations?fromChainId=` lists them.
Two chains are token delivery: their native coin has no gas bridge, so it arrives as that
chain's token on BNB Chain, not as gas (quotes say so in `receiveToken`): Mitosis (MITO, via
Hyperlane) and Endurance (ACE, via Fusionist's bridge, to the sending wallet only).

| Chain | ID | Token | Chain | ID | Token |
|-------|---:|-------|-------|---:|-------|
| Ethereum | 1 | ETH | Arc | 5042 | USDC |
| Optimism | 10 | ETH | Superseed | 5330 | ETH |
| BNB Chain | 56 | BNB | Kaia | 8217 | KAIA |
| Gnosis | 100 | xDAI | Base | 8453 | ETH |
| Unichain | 130 | ETH | Plasma | 9745 | XPL |
| Polygon | 137 | POL | 0G | 16661 | 0G |
| Sonic | 146 | S | Apechain | 33139 | APE |
| Manta Pacific | 169 | ETH | Mode | 34443 | ETH |
| X Layer | 196 | OKB | Mythos | 42018 | ETH |
| Fraxtal | 252 | FRAX | Arbitrum | 42161 | ETH |
| Shape | 360 | ETH | Arbitrum Nova | 42170 | ETH |
| World Chain | 480 | ETH | Celo | 42220 | CELO |
| Endurance | 648 | ACE | Hemi | 43111 | ETH |
| Stable | 988 | gUSDT | Zircuit | 48900 | ETH |
| Lisk | 1135 | ETH | Ink | 57073 | ETH |
| Intuition | 1155 | TRUST | Linea | 59144 | ETH |
| Sei | 1329 | SEI | BOB | 60808 | ETH |
| Story | 1514 | IP | Berachain | 80094 | BERA |
| Pharos | 1672 | PROS | Doma | 97477 | ETH |
| Soneium | 1868 | ETH | Plume | 98866 | PLUME |
| Ronin | 2020 | RON | Mitosis | 124816 | MITO |
| Morph | 2818 | ETH | Taiko | 167000 | ETH |
| MegaETH | 4326 | ETH | Scroll | 534352 | ETH |
| Robinhood Chain | 4663 | ETH | Gensyn | 685689 | ETH |
| Mantle | 5000 | MNT | Katana | 747474 | ETH |
| Somnia | 5031 | SOMI | Zora | 7777777 | ETH |

This table is generated from the live API, which is the only authoritative
answer to what an integration can actually use:

```bash
node scripts/generate-chain-docs.mjs          # regenerate
node scripts/generate-chain-docs.mjs --check  # fail if a doc has drifted
curl https://api.zerodust.xyz/chains          # the source of truth
```

Please do not hand-edit it. Earlier versions of this table claimed 26 live
chains and named 1514 "Astar zkEVM", 5330 "Kaia" and 57073 "Redstone" — three
chains that are not the ones deployed there. An agent that acts on a wrong chain
name gets an error and reasonably concludes the service is broken.

The contract is also on 46 testnets, but **the API serves no testnet chains**, so
there is no testnet environment to integrate against. Use the `dryRun` option in
the SDK or the MCP server to exercise the full flow without moving funds.

See [contracts/README.md](./contracts/README.md) for explorer links.

## Project Structure

```
zerodust/
├── contracts/          # Smart contracts (Foundry)
│   ├── src/
│   │   ├── ZeroDustSweepMainnet.sol   # Production contract
│   │   └── ZeroDustSweepTEST.sol      # Testnet contract
│   ├── script/
│   │   └── DeployMainnet.s.sol        # Mainnet deployment (CREATE2)
│   └── broadcast/                      # Deployment logs
└── docs/
```

## Architecture

### Contract Architecture

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

**Service Fee:** 1% of swept value, with $0.05 minimum and $0.50 maximum; balances under $1 pay 5% with no minimum.

```
Total Fee = Gas Reimbursement + Service Fee + Bridge Fee (if cross-chain)

Examples:
- $5 balance → $0.05 fee (1% = $0.05, at min) → User receives ~$4.95
- $10 balance → $0.10 fee (1%) → User receives ~$9.90
- $60 balance → $0.50 fee (max) → User receives ~$59.50
```

## Documentation

- [contracts/README.md](./contracts/README.md) - Contract details and deployment
- [contracts/SPECIFICATION.md](./contracts/SPECIFICATION.md) - Technical specification
- [contracts/DEPLOYMENT.md](./contracts/DEPLOYMENT.md) - Deployment guide

## Security

ZeroDust is designed with security as the top priority:

- **No fund custody** - All operations are atomic, single-transaction
- **User-controlled limits** - maxTotalFeeWei and minReceive signed by user
- **Mandatory simulation** - Every transaction simulated before execution
- **routeHash binding** - Signature bound to specific bridge route (cross-chain)
- **Internal security review** - 7 rounds, 16 issues identified and fixed
- **External audit** - Pending (required before full launch)

## Status

**Smart Contract:** Deployed on 52 mainnets + 46 testnets. **All 52 mainnets are
enabled in the API**; the API serves no testnets.

### Contract Versions

| Contract | Status | Features |
|---------|--------|----------|
| ZeroDustSweepMainnet | **Production** | Unified SweepIntent, granular fees, sponsor model |
| ZeroDustSweepTEST | Testnet | Same as mainnet, for testing |

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

ZeroDust supports cross-chain sweeps via the MODE_CALL pattern:

- **callTarget**: Bridge contract address
- **callData**: Bridge-specific transaction data
- **routeHash**: `keccak256(callData)` - binds signature to specific route

**Primary Bridge:** [Gas.zip](https://gas.zip) - 239+ chains, ~5 second delivery

## License

MIT License - see [LICENSE](./LICENSE)

---

**Live on 25 mainnet chains.** Contract: `0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2`
(same address on every chain, via CREATE2).
