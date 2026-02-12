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

## Available Tools

| Tool | Description |
|------|-------------|
| `zerodust_info` | Get information about ZeroDust service and fees |
| `zerodust_get_chains` | List all supported blockchain chains |
| `zerodust_get_balances` | Check native token balances across all chains |
| `zerodust_get_quote` | Get a quote for sweeping a chain |
| `zerodust_get_sweep_status` | Check status of a submitted sweep |
| `zerodust_list_sweeps` | List past sweeps for an address |

## Example Prompts

Once configured, you can ask Claude:

- "What chains does ZeroDust support?"
- "Check my balances on 0x1234..."
- "Get a quote to sweep my Arbitrum ETH to Base"
- "What's the status of my sweep?"

## License

MIT
