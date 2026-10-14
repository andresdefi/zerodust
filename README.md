# ZeroDust

**Empty a wallet's native gas balance on an EVM chain to exactly 0.**

A normal transfer cannot send a whole native balance, because paying for the transfer uses the token
being sent. ZeroDust sends all of it, to any address on the same chain or bridged to another chain,
and the wallet ends at exactly 0 wei. Live at [zerodust.xyz](https://zerodust.xyz), with an API at
`https://api.zerodust.xyz` and developer docs at [zerodust.xyz/docs](https://zerodust.xyz/docs).

This repository holds the contracts, the TypeScript SDK and the agent packages.

## How it works

- **Sponsored chains (EIP-7702)**: the wallet signs a `SweepIntent` and two EIP-7702 authorizations
  (one delegating to the ZeroDust contract, one removing it afterwards). A ZeroDust sponsor executes
  the sweep and pays the gas, reimbursed from the swept balance. The contract runs as the wallet and
  reverts unless the balance ends at exactly 0.
- **MetaMask without a key**: MetaMask's Advanced Permissions (ERC-7715) grant
  `ZeroDustPermissionRouter` a one-time allowance per chain; one EIP-712 signature covers every chain.
  The router redeems it, requires exactly 0, and settles like the contract. 16 chains.
- **Direct chains (no EIP-7702)**: the wallet sends its own legacy transactions, sized to the wei by
  the API's planner (21 chains). On OP-stack chains with an L1 data fee it goes through
  `ZeroDustGuard`; on ZK-stack chains a ZeroDust paymaster pays the gas.
- **What arrives**: the destination's native gas, carried by Relay, Across (ETH to ETH), Stargate or
  Gas.zip, whichever delivers the most. A few chains whose coin no gas bridge carries deliver it as a
  token instead (Mitosis, Endurance, Intuition, Telos), said plainly in the quote. On request a sweep
  can also go into the chain's own bridge to Ethereum, which the recipient claims there later.

## For AI agents

Agents accumulate dust as a byproduct of existing. Anything doing multi-chain
work - arbitrage, bridging, testing, deployment - ends up with stranded gas on
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
| `ZERODUST_SIGNER_MODULE` | your custody provider - any module returning a viem `LocalAccount`, which is what Turnkey, Privy and KMS adapters produce |
| `ZERODUST_KEYSTORE_FILE` | an encrypted V3 keystore, with the password in a separate file |
| `ZERODUST_PRIVATE_KEY_FILE` | a file on disk, not in the config |
| `ZERODUST_PRIVATE_KEY` | the config (simplest, least private) |

Funds can only go to the agent's own address unless
`ZERODUST_ALLOWED_DESTINATIONS` says otherwise - so a prompt-injected agent still
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
| [`@zerodust/sdk`](https://www.npmjs.com/package/@zerodust/sdk) | TypeScript, direct - `createAgentFromPrivateKey` |
| [`@zerodust/langchain`](https://www.npmjs.com/package/@zerodust/langchain) | LangChain tools |
| [`@zerodust/ai-sdk`](https://www.npmjs.com/package/@zerodust/ai-sdk) | Vercel AI SDK tools |

## Contracts

| Contract | Address (same on every chain, CREATE2) | Where |
|---|---|---|
| ZeroDustSweep (`contracts/src/ZeroDustSweepMainnet.sol`) | `0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2` | the 57 sponsored chains below |
| ZeroDustPermissionRouter v2 (`contracts/src/ZeroDustPermissionRouter.sol`) | `0x369A97dd256F7eb37fF7116C4EcBd50318eBb286` | 16 chains with MetaMask Advanced Permissions |
| ZeroDustGuard (`contracts/src/ZeroDustGuard.yul`) | `0x2f95e6ED90a7dD67fc3Fae5c5628647E6A83e48e` | Blast, Boba |
| ZeroDustPaymaster (`contracts-zk/`) | `0x986e4Bb55AEEE6a8c80c28Ca787b13E216fD25B8` | zkSync Era, Abstract, Lens |

All are immutable: no admin functions, no upgrades, no pause (the paymaster's owner can only change
its approver and withdraw its float). The sweep contract's sponsor address is fixed in its bytecode.

## Supported chains

52 sponsored chains, generated from the live API (`GET https://api.zerodust.xyz/chains`):

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
| DATA Network | 1514 | DATA | Berachain | 80094 | BERA |
| Pharos | 1672 | PROS | Codex | 81224 | ETH |
| Reya | 1729 | ETH | Doma | 97477 | ETH |
| Metal L2 | 1750 | ETH | Plume | 98866 | PLUME |
| Soneium | 1868 | ETH | Mitosis | 124816 | MITO |
| Ronin | 2020 | RON | Taiko | 167000 | ETH |
| Morph | 2818 | ETH | HPP | 190415 | ETH |
| RISE | 4153 | ETH | Scroll | 534352 | ETH |
| MegaETH | 4326 | ETH | Gensyn | 685689 | ETH |
| Robinhood Chain | 4663 | ETH | Katana | 747474 | ETH |
| Mantle | 5000 | MNT | Zora | 7777777 | ETH |
| Somnia | 5031 | SOMI |  | |  |

Regenerate or check this table with `node scripts/generate-chain-docs.mjs` (`--check` runs in CI); do
not hand-edit it. The 21 direct chains are listed by `GET https://api.zerodust.xyz/direct/chains`:
Flare, Cronos, Rootstock, Telos, XDC, Fuse, Monad, Lens, Boba, zkSync Era, Flow EVM, HyperEVM, Metis,
Vana, Gravity, Abstract, Immutable zkEVM, Etherlink, Avalanche, Blast and Ethereal. Destinations are
any EVM chain a bridge delivers native gas to (`GET /destinations?fromChainId=`), over 100 from Base.

## Fees

1% of the swept value, at least $0.05 and at most $0.50; balances under $1 pay 5%, with no minimum.
On top: the sweep's gas (and the L1 data fee on rollups) and, cross-chain, the bridge's fee. The
signed `maxTotalFeeWei` caps what can be taken, so a gas spike cannot exceed what you agreed to.

## Security

- No custody: every sweep is one atomic transaction from the wallet itself.
- The signed intent caps the fee and names the destination; for a bridge route `routeHash`
  (`keccak256(callData)`) binds the signature to that exact call.
- Every sponsored transaction is simulated before it is sent.
- ERC-7201 namespaced storage, so the contract's nonce never collides with another EIP-7702 app.
- Internal security review, 7 rounds, 16 issues found and fixed; contract tests drive a real EIP-7702
  delegation and are mutation-verified. **Not externally audited, and no audit is currently funded.**
  Details: [contracts/SECURITY.md](./contracts/SECURITY.md),
  [contracts/SECURITY_REPORT.md](./contracts/SECURITY_REPORT.md).

## Layout

```
contracts/      Foundry: ZeroDustSweepMainnet.sol, ZeroDustPermissionRouter.sol, ZeroDustGuard.yul,
                tests, deploy scripts and broadcasts (README, SPECIFICATION, DEPLOYMENT, SECURITY)
contracts-zk/   ZeroDustPaymaster for ZK-stack chains (Hardhat + zksolc)
sdk/            @zerodust/sdk
packages/       @zerodust/mcp-server, @zerodust/ai-sdk, @zerodust/langchain
skills/         an agent skill for ZeroDust
scripts/        generate-chain-docs.mjs
```

## License

MIT, see [LICENSE](./LICENSE).
