# @zerodust/mcp-server

Model Context Protocol (MCP) server for [ZeroDust](https://zerodust.xyz) - sweep native gas tokens to exactly zero.

## Installation

```bash
npm install -g @zerodust/mcp-server
```

Or run directly with npx:

```bash
npx @zerodust/mcp-server
```

## Configuration

### Claude Desktop

Add to your `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "zerodust": {
      "command": "npx",
      "args": ["@zerodust/mcp-server"]
    }
  }
}
```

### Claude Code

Add to your `.claude/settings.json`:

```json
{
  "mcpServers": {
    "zerodust": {
      "command": "npx",
      "args": ["@zerodust/mcp-server"]
    }
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ZERODUST_API_URL` | Custom API URL | `https://api.zerodust.xyz` |
| `ZERODUST_API_KEY` | API key for higher rate limits | - |
| `ZERODUST_ALLOW_EXECUTE` | Set to `true` to enable sweeping | `false` |
| `ZERODUST_ALLOWED_DESTINATIONS` | Comma-separated destination allowlist | own address only |

Signing keys have their own section below — there are four ways to supply one,
and exactly one may be set at a time.

| Variable | Description |
|----------|-------------|
| `ZERODUST_SIGNER_MODULE` | Module returning a viem `LocalAccount` (Turnkey, Privy, KMS, ...) |
| `ZERODUST_KEYSTORE_FILE` | Encrypted V3 keystore, with `ZERODUST_KEYSTORE_PASSWORD_FILE` or `ZERODUST_KEYSTORE_PASSWORD` |
| `ZERODUST_PRIVATE_KEY_FILE` | File containing a hex private key |
| `ZERODUST_PRIVATE_KEY` | Hex private key inline |

## Available Tools

Read-only by default:

| Tool | Description |
|------|-------------|
| `zerodust_info` | Get information about ZeroDust service and fees |
| `zerodust_get_chains` | List all supported blockchain chains |
| `zerodust_get_balances` | Check native token balances across all chains |
| `zerodust_get_quote` | Get a quote for sweeping a chain |
| `zerodust_get_sweep_status` | Check status of a submitted sweep |
| `zerodust_list_sweeps` | List past sweeps for an address |
| `zerodust_register_api_key` | Issue this agent its own API key, no human signup |

Added when execution is enabled (see below):

| Tool | Description |
|------|-------------|
| `zerodust_get_agent_address` | Show the signing address and permitted destinations |
| `zerodust_sweep` | Sweep one chain to exactly zero |
| `zerodust_sweep_all` | Sweep every chain with a balance to one destination |

## Try it without moving funds

Every sweep tool accepts `dryRun`. It fetches a real quote, requests the real
EIP-712 typed data, and produces all three real signatures with your key, then
stops before submitting. Nothing is broadcast and no balance changes.

> "Do a dry run of sweeping my Arbitrum balance to Base"

Use this first. It exercises the entire path an actual sweep takes — key
handling, chain support, fee limits, signature construction — so anything
misconfigured surfaces while your funds are still where they were.

There is deliberately no testnet mode: the ZeroDust API currently serves no
testnet chains, so a testnet flag would only produce empty chain lists and
failing quotes. `dryRun` gives you the same confidence against production.

## Enabling sweeps

Sweeping moves real funds, so it is off unless you turn it on. Set
`ZERODUST_ALLOW_EXECUTE=true` **and** exactly one signing key.

Whichever you choose, the key is used locally to sign an EIP-7702 authorization
and an EIP-712 sweep intent. It is never transmitted — only signatures reach the
ZeroDust API.

### Option 1: a signer module (recommended for production)

Point ZeroDust at a module that returns a viem `LocalAccount`. This is how you
use Turnkey, Privy, AWS KMS, or any other custody service: ZeroDust never sees a
raw key, and it does not need to know which vendor you use.

```js
// my-signer.mjs
export default async function createAccount() {
  // Build a viem LocalAccount however your custody provider prefers.
  // Any account that can sign EIP-712 typed data and EIP-7702
  // authorizations works.
  return await myProvider.toViemAccount();
}
```

```json
"env": {
  "ZERODUST_ALLOW_EXECUTE": "true",
  "ZERODUST_SIGNER_MODULE": "./my-signer.mjs"
}
```

The module is validated when it loads: if the account it returns cannot sign an
EIP-7702 authorization, the server says so immediately rather than failing part
way through a sweep.

### Option 2: an encrypted keystore

The V3 keystore format produced by `cast wallet import` and geth. Keep the
password in a file so neither the key nor the password lives in your MCP config.

```json
"env": {
  "ZERODUST_ALLOW_EXECUTE": "true",
  "ZERODUST_KEYSTORE_FILE": "./agent-keystore.json",
  "ZERODUST_KEYSTORE_PASSWORD_FILE": "./agent-keystore.pass"
}
```

### Option 3: a key file

```json
"env": {
  "ZERODUST_ALLOW_EXECUTE": "true",
  "ZERODUST_PRIVATE_KEY_FILE": "./agent.key"
}
```

### Option 4: an inline key

Simplest, and the least private — the key sits in a config file you may well
commit. Fine for a throwaway wallet, not for one holding anything you care about.

```json
"env": {
  "ZERODUST_ALLOW_EXECUTE": "true",
  "ZERODUST_PRIVATE_KEY": "0x..."
}
```

### Destination allowlist

By default funds can only be swept to the agent's **own address**. This is the
main protection against prompt injection: an agent talked into sweeping
somewhere it shouldn't still cannot send funds to an address you never approved.

To permit other destinations, list them explicitly:

```json
"ZERODUST_ALLOWED_DESTINATIONS": "0xYourColdWallet,0xYourExchangeDeposit"
```

Treat this like any other spending authority — anything listed here can receive
the agent's entire balance across every supported chain.

## Example Prompts

Once configured, you can ask Claude:

- "What chains does ZeroDust support?"
- "Check my balances on 0x1234..."
- "Get a quote to sweep my Arbitrum ETH to Base"
- "What's the status of my sweep?"

With execution enabled:

- "Do a dry run of sweeping my Arbitrum balance to Base" (moves nothing)
- "Sweep my Arbitrum balance to Base"
- "Exit every chain and consolidate everything on Base"

## No install: the hosted server

If you only need the read-only tools, there is nothing to install. Connect to
the hosted server by URL:

```
https://api.zerodust.xyz/mcp
```

It exposes the same tool names as this package. Sweeping is not available there,
because sweeping needs a key and the hosted server does not have yours.

## Development

```bash
npm install
npm test        # unit tests
npm run build
```

## License

MIT
