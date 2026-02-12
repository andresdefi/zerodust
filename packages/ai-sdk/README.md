# @zerodust/ai-sdk

Vercel AI SDK tools for [ZeroDust](https://zerodust.xyz) - sweep native gas tokens to exactly zero.

## Installation

```bash
npm install @zerodust/ai-sdk ai zod
```

## Usage

```typescript
import { createZeroDustTools } from '@zerodust/ai-sdk';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

// Create ZeroDust tools
const tools = createZeroDustTools({ environment: 'mainnet' });

// Use with generateText
const result = await generateText({
  model: openai('gpt-4o'),
  tools,
  prompt: 'Check my balances on 0x1234...',
});

// Or with streamText
import { streamText } from 'ai';

const stream = streamText({
  model: openai('gpt-4o'),
  tools,
  prompt: 'What chains does ZeroDust support?',
});
```

## Available Tools

| Tool | Description |
|------|-------------|
| `zerodust_info` | Get information about ZeroDust service and fees |
| `zerodust_get_chains` | List all supported blockchain chains |
| `zerodust_get_balances` | Check native token balances across all chains |
| `zerodust_get_quote` | Get a quote for sweeping a chain |
| `zerodust_get_sweep_status` | Check status of a submitted sweep |
| `zerodust_list_sweeps` | List past sweeps for an address |

## Configuration

```typescript
const tools = createZeroDustTools({
  environment: 'mainnet', // or 'testnet'
  apiKey: 'your-api-key', // optional, for higher rate limits
  timeout: 30000,         // request timeout in ms
});
```

## License

MIT
