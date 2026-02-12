# ZeroDust AI Agent Integration Guide

This guide explains how AI agents can use ZeroDust to sweep native gas tokens to zero when exiting chains or addresses they no longer use.

## Overview

ZeroDust enables autonomous agents to:
- **Exit chains completely** - Sweep entire native token balance to another chain
- **Consolidate funds** - Move scattered balances to a single destination
- **Zero-out addresses** - Leave exactly 0 balance when abandoning an address

Unlike traditional wallet integrations, AI agents control their own private keys and can sign programmatically without user interaction.

## Quick Start

### Installation

```bash
npm install @zerodust/sdk viem
```

### Basic Usage

```typescript
import { createAgentFromPrivateKey } from '@zerodust/sdk';

// Create agent from private key
const agent = await createAgentFromPrivateKey(
  '0x...your_private_key...',
  { environment: 'mainnet' }
);

// Sweep Arbitrum balance to Base
const result = await agent.sweep({
  fromChainId: 42161,  // Arbitrum
  toChainId: 8453,     // Base
});

console.log(`Swept! Destination balance: ${result.quote.estimatedReceive}`);
```

### Sweep All Chains

```typescript
// Get all chains with sweepable balances
const balances = await agent.getSweepableBalances();
console.log(`Found ${balances.length} chains with balance`);

// Sweep everything to Base
const results = await agent.sweepAll({
  toChainId: 8453,
  destination: '0x...optional_different_address...'
});

console.log(`Swept ${results.successful.length} chains`);
console.log(`Failed: ${results.failed.length}`);
```

## API Key Registration

For production use, register for an API key to get higher rate limits:

```typescript
import { ZeroDust } from '@zerodust/sdk';

// Register your agent
const client = new ZeroDust({ environment: 'mainnet' });

const response = await fetch('https://api.zerodust.xyz/agent/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'My AI Agent',
    agentId: 'my-agent-v1',
    contactEmail: 'agent@example.com',
    webhookUrl: 'https://my-agent.com/webhook',
    metadata: {
      framework: 'langchain',
      version: '1.0.0'
    }
  })
});

const { apiKey } = await response.json();
// SAVE THIS - only shown once!

// Use the API key in your agent
const agentWithKey = await createAgentFromPrivateKey(privateKey, {
  environment: 'mainnet',
  apiKey: apiKey
});
```

### Rate Limits

| Key Type | Requests/Min | Daily Sweeps |
|----------|--------------|--------------|
| No key   | 60           | 100          |
| Agent    | 300          | 1,000        |
| Partner  | 1,000        | 10,000       |

## ZeroDustAgent Class

### Constructor

```typescript
import { ZeroDustAgent, type ZeroDustAgentConfig } from '@zerodust/sdk';
import { privateKeyToAccount } from 'viem/accounts';

const config: ZeroDustAgentConfig = {
  account: privateKeyToAccount('0x...'),
  environment: 'mainnet', // or 'testnet'
  apiKey: 'zd_...', // optional
  baseUrl: 'https://api.zerodust.xyz', // optional custom URL
};

const agent = new ZeroDustAgent(config);
```

### Methods

#### `sweep(request, options?)`

Execute a single sweep from one chain to another.

```typescript
const result = await agent.sweep({
  fromChainId: 42161,      // Source chain
  toChainId: 8453,         // Destination chain
  destination: '0x...',    // Optional: different destination address
}, {
  waitForCompletion: true, // Default: true
  pollingInterval: 2000,   // Default: 2000ms
  timeout: 300000,         // Default: 5 minutes
});

// Result includes quote, sweep status, and transaction hashes
console.log(result.quote.estimatedReceive);
console.log(result.sweepId);
console.log(result.status); // 'completed', 'bridging', etc.
```

#### `batchSweep(request, options?)`

Execute multiple sweeps in parallel.

```typescript
const results = await agent.batchSweep({
  sweeps: [
    { fromChainId: 42161 },  // Arbitrum
    { fromChainId: 10 },     // Optimism
    { fromChainId: 137 },    // Polygon
  ],
  toChainId: 8453,           // All to Base
  destination: '0x...',      // Optional
});

console.log(`Success: ${results.successful.length}`);
console.log(`Failed: ${results.failed.length}`);
```

#### `sweepAll(options)`

Sweep all chains with balance above threshold to a single destination.

```typescript
const results = await agent.sweepAll({
  toChainId: 8453,
  destination: '0x...',      // Optional
  minBalanceUsd: 1.00,       // Optional: minimum $1 balance
});
```

#### `getSweepableBalances(minBalanceUsd?)`

Get all chains where the agent has sweepable balance.

```typescript
const balances = await agent.getSweepableBalances(0.50); // min $0.50

for (const balance of balances) {
  console.log(`${balance.chainName}: ${balance.balanceFormatted} (${balance.balanceUsd})`);
}
```

#### `getBalance(chainId)`

Get balance on a specific chain.

```typescript
const balance = await agent.getBalance(8453); // Base
console.log(`Balance: ${balance.balanceFormatted} ETH`);
```

## Batch Sweep API Endpoint

For maximum efficiency, use the batch sweep endpoint directly:

```typescript
const response = await fetch('https://api.zerodust.xyz/agent/batch-sweep', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    sweeps: [
      { fromChainId: 42161 },
      { fromChainId: 10 },
      { fromChainId: 137 },
    ],
    destination: '0x...',
    consolidateToChainId: 8453, // All to Base
  })
});

const { results, summary } = await response.json();
// Each result contains quote + typedData for signing
```

## Signing Flow

ZeroDust uses EIP-7702 for gasless execution. The agent signs:

1. **EIP-7702 Authorization** - Temporarily delegates EOA to ZeroDust contract
2. **EIP-712 SweepIntent** - Authorizes the specific sweep parameters
3. **Revoke Authorization** - Pre-signed to restore EOA after sweep

The `ZeroDustAgent` class handles all signing automatically. For manual signing:

```typescript
import { signTypedData, signAuthorization } from 'viem/accounts';

// Get authorization data
const auth = await client.createAuthorization(quoteId);

// Sign EIP-712 SweepIntent
const signature = await signTypedData({
  account,
  ...auth.typedData,
});

// Sign EIP-7702 delegations
const delegationAuth = await signAuthorization({
  account,
  contractAddress: auth.eip7702.contractAddress,
  chainId: auth.eip7702.chainId,
  nonce: auth.eip7702.nonce,
});

// Submit signed sweep
await client.submitSweep({
  quoteId: quote.quoteId,
  signature,
  eip7702Authorization: delegationAuth,
});
```

## Error Handling

```typescript
import {
  ZeroDustError,
  BalanceTooLowError,
  QuoteExpiredError,
  ChainNotSupportedError,
} from '@zerodust/sdk';

try {
  await agent.sweep({ fromChainId: 42161, toChainId: 8453 });
} catch (error) {
  if (error instanceof BalanceTooLowError) {
    console.log('Balance too low to sweep:', error.details?.minimumRequired);
  } else if (error instanceof QuoteExpiredError) {
    console.log('Quote expired, retrying...');
    // Retry automatically handled by agent
  } else if (error instanceof ChainNotSupportedError) {
    console.log('Chain not supported:', error.details?.chainId);
  } else if (error instanceof ZeroDustError) {
    console.log('ZeroDust error:', error.code, error.message);
  }
}
```

## Supported Chains

ZeroDust supports 26 EIP-7702 compatible mainnets:

| Chain | Chain ID | Native Token |
|-------|----------|--------------|
| Ethereum | 1 | ETH |
| Optimism | 10 | ETH |
| BSC | 56 | BNB |
| Gnosis | 100 | xDAI |
| Polygon | 137 | POL |
| Base | 8453 | ETH |
| Arbitrum | 42161 | ETH |
| Celo | 42220 | CELO |
| Scroll | 534352 | ETH |
| Zora | 7777777 | ETH |
| ... and more |

Get the full list:

```typescript
const chains = await client.getChains();
console.log(chains.map(c => c.name));
```

## Best Practices

### 1. Use API Keys in Production

Register for an API key to get higher rate limits and usage analytics.

### 2. Handle Partial Failures

Batch sweeps may partially succeed. Always check results:

```typescript
const results = await agent.sweepAll({ toChainId: 8453 });

for (const failure of results.failed) {
  console.error(`Failed to sweep chain ${failure.chainId}: ${failure.error}`);
  // Consider retry logic
}
```

### 3. Set Reasonable Timeouts

Cross-chain sweeps can take a few minutes. Set appropriate timeouts:

```typescript
await agent.sweep(request, {
  timeout: 600000, // 10 minutes for cross-chain
});
```

### 4. Monitor Your Agent's Activity

Use the /agent/me endpoint to check usage:

```typescript
const stats = await fetch('https://api.zerodust.xyz/agent/me', {
  headers: { 'Authorization': `Bearer ${apiKey}` }
}).then(r => r.json());

console.log(`Daily sweeps: ${stats.rateLimits.dailyUsed}/${stats.rateLimits.daily}`);
```

### 5. Secure Your Private Keys

- Never hardcode private keys
- Use environment variables or secure vaults
- Consider using HSM/KMS for production

## Webhook Notifications

If you provided a webhook URL during registration, you'll receive notifications:

```typescript
// Your webhook receives POST requests like:
{
  "event": "sweep.completed",
  "sweepId": "123e4567-e89b-...",
  "status": "completed",
  "fromChainId": 42161,
  "toChainId": 8453,
  "amountReceived": "0.00095",
  "txHash": "0x..."
}
```

Events: `sweep.pending`, `sweep.executing`, `sweep.bridging`, `sweep.completed`, `sweep.failed`

## Support

- GitHub Issues: https://github.com/zerodustxyz/zerodust
- Email: agents@zerodust.xyz
- Discord: https://discord.gg/zerodust

## License

MIT License - See LICENSE file for details.
