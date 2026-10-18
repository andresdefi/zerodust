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
  the API's planner (22 chains). On OP-stack chains with an L1 data fee it goes through
  `ZeroDustGuard`; on ZK-stack chains a ZeroDust paymaster pays the gas.
- **What arrives**: the destination's native gas, carried by Relay, Across (ETH to ETH), Stargate or
  Gas.zip, whichever delivers the most. A few chains whose coin no gas bridge carries deliver it as a
  token instead (Mitosis, Endurance, Intuition, Telos, 0G), said plainly in the quote. On request a
  sweep can also go into the chain's own bridge to Ethereum (to BNB Chain for opBNB), which the
  recipient proves and claims there later; Gravity's G and Fraxtal's FRAX arrive on Ethereum as the
  G and FXS tokens.

## For AI agents (paused)

The agent packages (`@zerodust/mcp-server`, `@zerodust/ai-sdk`, `@zerodust/langchain`) are paused
and deprecated on npm, and the hosted MCP endpoint and agent key signup are switched off. The local
MCP server and the SDK still sweep through the public API with your own key; keys issued before keep
their rate limits. To sweep, use [zerodust.xyz](https://zerodust.xyz).

| Package | Use |
|---------|-----|
| [`@zerodust/sdk`](https://www.npmjs.com/package/@zerodust/sdk) | TypeScript client and agent (`createAgentFromPrivateKey`); the website uses it |
| [`@zerodust/mcp-server`](https://www.npmjs.com/package/@zerodust/mcp-server) | MCP server, run locally (paused) |
| [`@zerodust/langchain`](https://www.npmjs.com/package/@zerodust/langchain) | LangChain tools (paused) |
| [`@zerodust/ai-sdk`](https://www.npmjs.com/package/@zerodust/ai-sdk) | Vercel AI SDK tools (paused) |

## Contracts

| Contract | Address (same on every chain, CREATE2) | Where |
|---|---|---|
| ZeroDustSweep (`contracts/src/ZeroDustSweepMainnet.sol`) | `0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2` | the 56 sponsored chains below |
| ZeroDustPermissionRouter v2 (`contracts/src/ZeroDustPermissionRouter.sol`) | `0x369A97dd256F7eb37fF7116C4EcBd50318eBb286` | 16 chains with MetaMask Advanced Permissions |
| ZeroDustGuard (`contracts/src/ZeroDustGuard.yul`) | `0x2f95e6ED90a7dD67fc3Fae5c5628647E6A83e48e` | Blast, Boba |
| ZeroDustPaymaster (`contracts-zk/`) | `0x986e4Bb55AEEE6a8c80c28Ca787b13E216fD25B8` | zkSync Era, Abstract, Lens |

All are immutable: no admin functions, no upgrades, no pause (the paymaster's owner can only change
its approver and withdraw its float). The sweep contract's sponsor address is fixed in its bytecode.

## Supported chains

56 sponsored chains, generated from the live API (`GET https://api.zerodust.xyz/chains`):

| Chain | ID | Token | Chain | ID | Token |
|-------|---:|-------|-------|---:|-------|
| Ethereum | 1 | ETH | Somnia | 5031 | SOMI |
| Optimism | 10 | ETH | Arc | 5042 | USDC |
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

Regenerate or check this table with `node scripts/generate-chain-docs.mjs` (`--check` runs in CI); do
not hand-edit it. The 22 direct chains are listed by `GET https://api.zerodust.xyz/direct/chains`:
Flare, Cronos, Rootstock, Telos, XDC, Fuse, Monad, opBNB, Lens, Boba, zkSync Era, Flow EVM, HyperEVM,
Metis, Vana, Gravity, Abstract, Immutable zkEVM, Etherlink, Avalanche, Blast and Ethereal. Destinations are
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
