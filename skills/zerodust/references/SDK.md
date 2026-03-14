# ZeroDust SDK Reference

## Installation

```bash
npm install @zerodust/sdk viem
```

## Two Usage Modes

### 1. ZeroDust Client (UI apps, wallets)

For apps where the user signs in their wallet. You handle the signing UX.

```typescript
import { ZeroDust } from '@zerodust/sdk';

const zerodust = new ZeroDust({ environment: 'mainnet' });

// Get balances
const { chains } = await zerodust.getBalances('0x...');
const sweepable = chains.filter(c => c.canSweep);

// Get quote
const quote = await zerodust.getQuote({
  fromChainId: 42161,
  toChainId: 8453,
  userAddress: '0x...',
  destination: '0x...',
});

// Get typed data for signing
const { typedData, contractAddress } = await zerodust.createAuthorization(quote.quoteId);

// User signs in wallet (your UX handles this)
const signature = await wallet.signTypedData(typedData);
const eip7702Auth = await wallet.signAuthorization({...});

// Submit
const sweep = await zerodust.submitSweep({
  quoteId: quote.quoteId,
  signature,
  eip7702Authorization: eip7702Auth,
  revokeAuthorization: revokeAuth,
});

// Wait for completion
const status = await zerodust.waitForSweep(sweep.sweepId);
```

### 2. ZeroDustAgent (AI agents, bots, automated systems)

For systems that control their own private key. All signing is automatic.

```typescript
import { ZeroDustAgent, createAgentFromPrivateKey } from '@zerodust/sdk';

// Option A: From private key
const agent = await createAgentFromPrivateKey('0x...', {
  environment: 'mainnet',
});

// Option B: From viem account
import { privateKeyToAccount } from 'viem/accounts';
const agent = new ZeroDustAgent({
  account: privateKeyToAccount('0x...'),
  environment: 'mainnet',
});
```

#### Single Chain Sweep

```typescript
const result = await agent.sweep({
  fromChainId: 42161,  // Arbitrum
  toChainId: 8453,     // Base
  destination: '0x...',
});

if (result.success) {
  console.log('TX:', result.txHash);
} else {
  console.log('Failed:', result.error);
}
```

#### Batch Sweep (Multiple Chains)

```typescript
const results = await agent.batchSweep({
  sweeps: [
    { fromChainId: 42161 },  // Arbitrum
    { fromChainId: 10 },     // Optimism
    { fromChainId: 137 },    // Polygon
  ],
  consolidateToChainId: 8453,  // All to Base
  continueOnError: true,
});

console.log(`${results.successful}/${results.total} sweeps completed`);
```

#### Sweep Everything

```typescript
// Exit all chains, consolidate to Base
const results = await agent.sweepAll({
  toChainId: 8453,
});
```

#### Check Balances

```typescript
// All balances
const allBalances = await agent.getBalances();

// Only sweepable (above minimum)
const sweepable = await agent.getSweepableBalances();

// Specific chain
const balance = await agent.getBalance(42161);
```

## Configuration

```typescript
const agent = new ZeroDustAgent({
  account: myAccount,
  environment: 'mainnet',     // or 'testnet'
  baseUrl: 'https://...',     // custom API URL
  apiKey: 'zd_...',           // agent API key
  timeout: 30000,             // request timeout ms
  retries: 3,                 // retry count
  rpcUrls: {                  // custom RPCs per chain
    42161: 'https://arb-mainnet.g.alchemy.com/v2/...',
  },
});
```

## Error Handling

All errors are typed:

```typescript
import { ZeroDustError, BalanceTooLowError } from '@zerodust/sdk';

try {
  await agent.sweep({...});
} catch (e) {
  if (e instanceof BalanceTooLowError) {
    // Balance too low to sweep
  } else if (e instanceof ZeroDustError) {
    console.log(e.code, e.message);
  }
}
```

Error types: `BalanceTooLowError`, `QuoteExpiredError`, `NetworkError`, `TimeoutError`, `ChainNotSupportedError`, `InvalidAddressError`, `SignatureError`, `BridgeError`.

## Signature Utilities

For advanced integrations:

```typescript
import {
  buildSweepIntentTypedData,
  buildSweepIntentFromQuote,
  computeRouteHash,
  SWEEP_INTENT_TYPES,
  MODE_TRANSFER,
  MODE_CALL,
} from '@zerodust/sdk';
```

## Exports

```typescript
// Main classes
export { ZeroDust, ZeroDustAgent, createAgentFromPrivateKey };

// Types
export type {
  Environment, ZeroDustConfig, Chain, ChainBalance,
  QuoteRequest, QuoteResponse, FeeBreakdown,
  SweepRequest, SweepResponse, SweepStatus,
  EIP712TypedData, EIP7702Authorization,
  AgentSweepRequest, AgentBatchSweepRequest,
  AgentSweepResult, AgentBatchSweepResult,
};

// Errors
export {
  ZeroDustError, BalanceTooLowError, QuoteExpiredError,
  NetworkError, TimeoutError, ChainNotSupportedError,
  InvalidAddressError, SignatureError, BridgeError,
};

// Utilities
export {
  validateAddress, validateChainId, validateSignature,
  buildSweepIntentTypedData, computeRouteHash,
  SWEEP_INTENT_TYPES, MODE_TRANSFER, MODE_CALL,
};
```
