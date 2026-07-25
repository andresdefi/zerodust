---
name: zerodust
description: "Sweep 100% of native gas tokens (ETH, BNB, MATIC, etc.) from EVM chains via ZeroDust, leaving exactly zero balance. Use when: user wants to exit a chain completely, consolidate dust balances, clean up wallets, or bridge remaining native tokens cross-chain. Supports 25 mainnet chains including Ethereum, Base, Arbitrum, Optimism, Polygon, BSC. Free for balances under $1."
license: MIT
compatibility: "Requires network access to ZeroDust API. For programmatic sweeps, requires viem and a private key. For user-facing sweeps, requires a wallet with EIP-7702 support."
metadata:
  author: andresdefi
  version: "1.0"
---

# ZeroDust - Chain Exit Infrastructure

ZeroDust sweeps 100% of native gas tokens from EVM chains, leaving **exactly zero balance**. It uses EIP-7702 sponsored execution so users never pay gas directly.

## When to Use This Skill

- User says "sweep", "dust", "exit chain", "consolidate", "clean up wallet", "move everything"
- User has small native token balances scattered across chains
- User wants to fully exit a blockchain (balance goes to exactly 0)
- Agent needs to consolidate funds from multiple chains to one

## How It Works

1. **Check balances** across 25 supported chains
2. **Get a quote** with fee breakdown
3. **User signs** EIP-7702 authorization + EIP-712 sweep intent (2 signatures)
4. **ZeroDust executes** the sweep - user receives funds on destination chain

The user never pays gas. ZeroDust's sponsor pays gas and is reimbursed from the swept amount.

## Integration Options

Choose based on your context:

| Approach | Best For | Requires |
|----------|----------|----------|
| **SDK (TypeScript)** | Apps, agents with private keys | `npm install @zerodust/sdk` |
| **REST API** | Any language, server-side | HTTP client |
| **MCP Server** | AI agents via Model Context Protocol | MCP-compatible client |

## Quick Start: TypeScript SDK

```typescript
import { ZeroDustAgent } from '@zerodust/sdk';
import { privateKeyToAccount } from 'viem/accounts';

const agent = new ZeroDustAgent({
  account: privateKeyToAccount('0x...'),
  environment: 'mainnet',
});

// Check what can be swept
const balances = await agent.getSweepableBalances();

// Sweep one chain (Arbitrum -> Base)
const result = await agent.sweep({
  fromChainId: 42161,
  toChainId: 8453,
  destination: '0x...',
});

// Or sweep ALL chains to Base
const results = await agent.sweepAll({ toChainId: 8453 });
```

**Prove it before moving anything.** Pass `dryRun: true` to run the whole flow —
real quote, real EIP-712 typed data, all three real signatures — and stop before
submitting. Nothing is broadcast and no balance changes.

```typescript
const check = await agent.sweep(
  { fromChainId: 42161, toChainId: 8453 },
  { dryRun: true }
);
check.dryRun;                  // true
check.sweepId;                 // undefined - nothing was submitted
check.quote?.estimatedReceive; // what would have arrived
```

There is no testnet environment (the API serves no testnet chains), so `dryRun`
is the way to validate an integration safely.

## Quick Start: REST API

```bash
# 1. Check balances
curl https://api.zerodust.xyz/balances/0xYOUR_ADDRESS?testnet=false

# 2. Get quote
curl "https://api.zerodust.xyz/quote?fromChainId=42161&toChainId=8453&userAddress=0x...&destination=0x..."

# 3. Get signing data
curl -X POST https://api.zerodust.xyz/authorization \
  -H "Content-Type: application/json" \
  -d '{"quoteId": "uuid-from-step-2"}'

# 4. Submit signed sweep
curl -X POST https://api.zerodust.xyz/sweep \
  -H "Content-Type: application/json" \
  -d '{
    "quoteId": "...",
    "signature": "0x...",
    "eip7702Authorization": {...},
    "revokeAuthorization": {...}
  }'

# 5. Check status
curl https://api.zerodust.xyz/sweep/SWEEP_ID
```

## Quick Start: MCP

Two servers, same tool names. Pick by whether the agent needs to actually sweep.

**Hosted, no install** — connect to `https://api.zerodust.xyz/mcp`. Read-only,
because it holds no keys.

**Local stdio** — `npx @zerodust/mcp-server`. Can sweep, because the key stays
on the agent's machine.

| Tool | Purpose | Where |
|------|---------|-------|
| `zerodust_get_chains` | List supported chains | both |
| `zerodust_get_balances` | Find stranded gas across all chains | both |
| `zerodust_get_quote` | Price emptying a chain to zero | both |
| `zerodust_get_sweep_status` | Check a submitted sweep | both |
| `zerodust_list_sweeps` | List past sweeps | both |
| `zerodust_register_api_key` | Self-issue an API key, no human signup | both |
| `zerodust_info` | Service details, pricing, integration | both |
| `zerodust_get_agent_address` | Show the signing wallet and its allowlist | stdio only |
| `zerodust_sweep` | Empty one chain to exactly zero | stdio only |
| `zerodust_sweep_all` | Empty every chain with a balance | stdio only |

The sweep tools accept `dryRun: true`, which rehearses the whole flow and moves
nothing. Use it first.

Sweeping requires `ZERODUST_ALLOW_EXECUTE=true` plus a signing key. The key can
come from a signer module returning a viem `LocalAccount` (Turnkey, Privy, KMS),
an encrypted V3 keystore, a key file, or `ZERODUST_PRIVATE_KEY` inline. Funds can
only go to the agent's own address unless `ZERODUST_ALLOWED_DESTINATIONS` lists
more.

## Agent API (Simplified)

For AI agents, there are dedicated endpoints that reduce round trips:

```bash
# Register for an API key
curl -X POST https://api.zerodust.xyz/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "My Agent", "agentId": "agent-001"}'
# Returns: { "apiKey": "zd_..." }

# Single sweep (combines quote + auth data)
curl -X POST https://api.zerodust.xyz/agent/sweep \
  -H "Authorization: Bearer zd_..." \
  -H "Content-Type: application/json" \
  -d '{
    "fromChainId": 42161,
    "toChainId": 8453,
    "userAddress": "0x...",
    "destination": "0x..."
  }'

# Batch sweep (multiple chains at once)
curl -X POST https://api.zerodust.xyz/agent/batch-sweep \
  -H "Authorization: Bearer zd_..." \
  -H "Content-Type: application/json" \
  -d '{
    "sweeps": [
      {"fromChainId": 42161},
      {"fromChainId": 10},
      {"fromChainId": 137}
    ],
    "destination": "0x...",
    "consolidateToChainId": 8453
  }'
```

## Supported Chains (25 Mainnet)

| Chain | ID | Token | Chain | ID | Token |
|-------|----|-------|-------|----|-------|
| Ethereum | 1 | ETH | Arbitrum | 42161 | ETH |
| Optimism | 10 | ETH | Celo | 42220 | CELO |
| BNB Chain | 56 | BNB | Ink | 57073 | ETH |
| Gnosis | 100 | xDAI | BOB | 60808 | ETH |
| Unichain | 130 | ETH | Berachain | 80094 | BERA |
| Polygon | 137 | POL | Scroll | 534352 | ETH |
| Sonic | 146 | S | Zora | 7777777 | ETH |
| X Layer | 196 | OKB | Sei | 1329 | SEI |
| Fraxtal | 252 | FRAX | Story | 1514 | IP |
| World Chain | 480 | ETH | Soneium | 1868 | ETH |
| Mantle | 5000 | MNT | Superseed | 5330 | ETH |
| Base | 8453 | ETH | Mode | 34443 | ETH |
| Plasma | 9745 | XPL | | | |

All chains support cross-chain sweeps to any other chain via Gas.zip (650 routes).

## Pricing

| Balance | Fee |
|---------|-----|
| Under $1 | **Free** (no service fee) |
| $1 - $5 | $0.05 (minimum) |
| $5 - $50 | 1% of balance |
| Over $50 | $0.50 (maximum) |

Gas costs (~1-3%) are included and paid by ZeroDust's sponsor, reimbursed from the sweep.

## Sweep Flow Details

For the complete API reference with all endpoints, request/response schemas, and error codes, see [references/API.md](references/API.md).

For SDK usage patterns including the Agent module, see [references/SDK.md](references/SDK.md).

## Key Constraints

- **Native tokens only** - ETH, BNB, MATIC, etc. Not ERC-20 tokens.
- **Sweep-all only** - Always sweeps 100% of balance. No partial sweeps.
- **EIP-7702 required** - Only works on chains that support EIP-7702.
- **Minimum balance** - Each chain has a minimum sweepable balance (covers fees).
- **Quote expires in 55 seconds** - Must sign and submit quickly.

## Contract

Mainnet address (same on all 25 chains via CREATE2):
```
0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2
```

## Links

- Website: https://zerodust.xyz
- API Docs: https://api.zerodust.xyz/docs
- MCP Server: https://api.zerodust.xyz/mcp
- ERC-8004 Agent: https://www.8004scan.io/agents/base/1435
- GitHub: https://github.com/andresdefi
