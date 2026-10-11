# ZeroDust SDK examples

Mainnet only (the API serves no testnets). The sweep examples do a **dry run** by default: a real
quote, checked and signed by the agent, but nothing is submitted. Set `SEND=1` to sweep for real,
and try a small balance first.

```bash
npm install @zerodust/sdk viem
npm install -D tsx
```

| Example | What it does | Run |
|---|---|---|
| `check-balances.ts` | Lists the sponsored chains where an address holds a native balance (no key) | `ADDRESS=0x... npx tsx examples/check-balances.ts` |
| `basic-sweep.ts` | Same-chain sweep to another address | `ZERODUST_PRIVATE_KEY=0x... CHAIN_ID=8453 DESTINATION=0x... npx tsx examples/basic-sweep.ts` |
| `cross-chain-sweep.ts` | Empties one chain, delivers native gas on another (default Arbitrum to Base) | `ZERODUST_PRIVATE_KEY=0x... FROM_CHAIN_ID=42161 TO_CHAIN_ID=8453 npx tsx examples/cross-chain-sweep.ts` |

Keep the key in an environment variable or a secrets store, never in source code. The key never
leaves the process: the agent sends only signatures. Full guide: https://zerodust.xyz/docs/getting-started
