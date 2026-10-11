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

| Key type | Requests per minute | Daily (quote, authorization and sweep requests) |
|----------|---------------------|-------------------------------------------------|
| No key   | per IP: 60 for quotes, 200 for reads | none |
| Agent    | 300 | 1,000 |
| Partner  | 1,000 | 10,000 |

Details: https://zerodust.xyz/docs/api#rate-limits

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
    userAddress: '0x...', // the wallet being swept
    destination: '0x...', // defaults to userAddress
    consolidateToChainId: 8453, // All to Base
  })
});

const { results, summary } = await response.json();
// Each result has the quote and the /authorization typed data; verify both
// locally (verifySweepQuote) before signing, then submit to POST /sweep
```

## Signing Flow

ZeroDust uses EIP-7702 for gasless execution. The agent signs:

1. **EIP-7702 Authorization** - Temporarily delegates EOA to ZeroDust contract
2. **EIP-712 SweepIntent** - Authorizes the specific sweep parameters
3. **Revoke Authorization** - Pre-signed to restore EOA after sweep

The `ZeroDustAgent` class handles all signing automatically, and verifies the
quote locally before it signs anything (see "What the agent checks before
signing" in the README). For manual signing, never sign the API's typed data or
delegate to an address the API names; build and check them locally:

```typescript
import { ZERODUST_CONTRACT_ADDRESS, verifySweepQuote, assertAuthorizationMatches } from '@zerodust/sdk';

// Build the SweepIntent locally from a verified quote (throws UNSAFE_QUOTE)
const { typedData } = await verifySweepQuote(quote, {
  signer: account.address,
  fromChainId,
  toChainId,
  destination,
  balanceWei,   // read from your own RPC
  gasPriceWei,  // read from your own RPC
  nowSeconds: Math.floor(Date.now() / 1000),
  resolveGasZipChainShort, // createGasZipChainShortResolver()
});

// The API's authorization must describe the same intent
assertAuthorizationMatches(await client.createAuthorization(quote.quoteId), typedData);

const signature = await walletClient.signTypedData({ account, ...typedData });

// Delegate to the ZeroDust contract only, then pre-sign the revoke (nonce + 1)
const delegation = await walletClient.signAuthorization({
  account,
  contractAddress: ZERODUST_CONTRACT_ADDRESS,
  chainId: fromChainId,
});
const revoke = await walletClient.signAuthorization({
  account,
  contractAddress: '0x0000000000000000000000000000000000000000',
  chainId: fromChainId,
  nonce: delegation.nonce + 1,
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

The SDK sweeps the 52 sponsored (EIP-7702) chains the API serves, from Ethereum, Base, Arbitrum,
Optimism and BNB Chain to MegaETH, Katana and Plume. The table is in the repository README; read the
live list rather than hardcoding it:

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

## Support

- GitHub Issues: https://github.com/andresdefi/zerodust
- Docs: https://zerodust.xyz/docs

## License

MIT License - See LICENSE file for details.
