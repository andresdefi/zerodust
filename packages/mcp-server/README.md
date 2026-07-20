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
| `ZERODUST_PRIVATE_KEY` | Signing key for the agent's wallet | - |
| `ZERODUST_ALLOWED_DESTINATIONS` | Comma-separated destination allowlist | own address only |

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

Added when execution is enabled (see below):

| Tool | Description |
|------|-------------|
| `zerodust_get_agent_address` | Show the signing address and permitted destinations |
| `zerodust_sweep` | Sweep one chain to exactly zero |
| `zerodust_sweep_all` | Sweep every chain with a balance to one destination |

## Enabling sweeps

Sweeping moves real funds, so it is off unless you turn it on. Set **both**:

```json
{
  "mcpServers": {
    "zerodust": {
      "command": "npx",
      "args": ["@zerodust/mcp-server"],
      "env": {
        "ZERODUST_ALLOW_EXECUTE": "true",
        "ZERODUST_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

The key is used locally to sign an EIP-7702 authorization and an EIP-712 sweep
intent. It is never transmitted — only signatures reach the ZeroDust API.

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

- "Sweep my Arbitrum balance to Base"
- "Exit every chain and consolidate everything on Base"

## License

MIT
