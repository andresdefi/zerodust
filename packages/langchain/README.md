# @zerodust/langchain

LangChain tools for [ZeroDust](https://zerodust.xyz) - sweep native gas tokens to exactly zero.

## Installation

```bash
npm install @zerodust/langchain @langchain/core zod
```

## Usage

```typescript
import { createZeroDustTools } from '@zerodust/langchain';
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';

// Create ZeroDust tools
const tools = createZeroDustTools({ environment: 'mainnet' });

// Use with any LangChain agent
const llm = new ChatOpenAI({ model: 'gpt-4o' });
const prompt = ChatPromptTemplate.fromMessages([
  ['system', 'You are a helpful blockchain assistant.'],
  ['human', '{input}'],
  ['placeholder', '{agent_scratchpad}'],
]);
const agent = createToolCallingAgent({ llm, tools, prompt });
const executor = new AgentExecutor({ agent, tools });

const result = await executor.invoke({
  input: 'Check my balances on 0x1234...',
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
