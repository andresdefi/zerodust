# @zerodust/sdk

[![CI](https://github.com/zerodustxyz/zerodust/actions/workflows/ci.yml/badge.svg)](https://github.com/zerodustxyz/zerodust/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@zerodust/sdk.svg)](https://www.npmjs.com/package/@zerodust/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@zerodust/sdk.svg)](https://www.npmjs.com/package/@zerodust/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TypeScript SDK for ZeroDust - sweep native gas tokens to exactly zero.

ZeroDust enables users to completely empty their native token balance (ETH, BNB, MATIC, etc.) from any EVM chain, sending the funds to any address on the same or different chain. This is powered by EIP-7702 sponsored execution.

## Installation

```bash
npm install @zerodust/sdk viem
```

```bash
yarn add @zerodust/sdk viem
```

```bash
pnpm add @zerodust/sdk viem
```

> **Note:** `viem` is a peer dependency and must be installed separately.

## Quick Start

```typescript
import { ZeroDust } from '@zerodust/sdk';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

// 1. Initialize the SDK
const zerodust = new ZeroDust({ environment: 'mainnet' });

// 2. Check balances across all chains
const balances = await zerodust.getBalances('0xYourAddress...');
console.log('Sweepable balances:', balances.balances.filter(b => b.isSweepable));

// 3. Get a quote for sweeping
const quote = await zerodust.getQuote({
  fromChainId: 8453,        // Base
  toChainId: 8453,          // Same chain (or different for cross-chain)
  userAddress: '0xYourAddress...',
  destination: '0xDestination...',
});

console.log('You will receive:', quote.minReceiveWei);
console.log('Total fees:', quote.fees.totalFeeWei);

// 4. Create authorization for signing
const { typedData, eip7702 } = await zerodust.createAuthorization(quote.quoteId);

// 5. Sign with your wallet (example using viem)
const account = privateKeyToAccount('0x...');
const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(),
});

// Sign the EIP-712 typed data
const signature = await walletClient.signTypedData(typedData);

// Sign the EIP-7702 authorization
const eip7702Authorization = await walletClient.signAuthorization({
  contractAddress: eip7702.contractAddress,
  chainId: eip7702.chainId,
  nonce: eip7702.nonce,
});

// 6. Submit the sweep
const sweep = await zerodust.submitSweep({
  quoteId: quote.quoteId,
  signature,
  eip7702Authorization: {
    chainId: eip7702Authorization.chainId,
    contractAddress: eip7702Authorization.contractAddress,
    nonce: eip7702Authorization.nonce,
    yParity: eip7702Authorization.yParity,
    r: eip7702Authorization.r,
    s: eip7702Authorization.s,
  },
});

// 7. Wait for completion
const result = await zerodust.waitForSweep(sweep.sweepId);
console.log('Sweep completed! TX:', result.txHash);
```

## Configuration

```typescript
const zerodust = new ZeroDust({
  // Environment: 'mainnet' or 'testnet'
  environment: 'mainnet',

  // Optional: Custom API URL (overrides environment)
  baseUrl: 'https://api.zerodust.xyz',

  // Optional: API key for higher rate limits
  apiKey: 'your-api-key',

  // Optional: Request timeout in ms (default: 30000)
  timeout: 30000,

  // Optional: Number of retries on failure (default: 3)
  retries: 3,
});
```

## API Reference

### Chain Methods

#### `getChains(testnet?: boolean): Promise<Chain[]>`

Get list of supported chains.

```typescript
const chains = await zerodust.getChains();

chains.forEach(chain => {
  console.log(`${chain.name} (${chain.chainId})`);
  console.log(`  Contract: ${chain.contractAddress}`);
  console.log(`  Min sweep: ${chain.minSweepWei} wei`);
});
```

#### `getChain(chainId: number): Promise<Chain>`

Get a specific chain by ID.

```typescript
const base = await zerodust.getChain(8453);
console.log(base.name); // 'Base'
```

### Balance Methods

#### `getBalances(address: string, testnet?: boolean): Promise<BalancesResponse>`

Get balances for an address across all supported chains.

```typescript
const { balances, totalUsd } = await zerodust.getBalances('0x...');

console.log(`Total value: $${totalUsd}`);

balances.forEach(balance => {
  if (balance.isSweepable) {
    console.log(`${balance.chainName}: ${balance.balanceFormatted}`);
  }
});
```

#### `getBalance(address: string, chainId: number): Promise<ChainBalance>`

Get balance for a specific chain.

```typescript
const balance = await zerodust.getBalance('0x...', 8453);

if (balance.isSweepable) {
  console.log(`Can sweep ${balance.balanceFormatted} from Base`);
}
```

### Quote Methods

#### `getQuote(params: QuoteRequest): Promise<QuoteResponse>`

Get a quote for sweeping. Quotes are valid for 60 seconds.

```typescript
// Same-chain sweep
const sameChainQuote = await zerodust.getQuote({
  fromChainId: 8453,
  toChainId: 8453,
  userAddress: '0x...',
  destination: '0x...',
});

// Cross-chain sweep (Arbitrum → Base)
const crossChainQuote = await zerodust.getQuote({
  fromChainId: 42161,  // Arbitrum
  toChainId: 8453,     // Base
  userAddress: '0x...',
  destination: '0x...',
});

// Quote response includes fee breakdown
console.log('Balance:', quote.balanceWei);
console.log('You receive:', quote.minReceiveWei);
console.log('Service fee:', quote.fees.serviceFeeWei);
console.log('Gas reimbursement:', quote.fees.gasReimbursementWei);
console.log('Bridge fee:', quote.fees.bridgeFeeWei);
console.log('Total fees:', quote.fees.totalFeeWei);
console.log('Expires:', quote.expiresAt);
```

### Authorization Methods

#### `createAuthorization(quoteId: string): Promise<AuthorizationResponse>`

Create EIP-712 typed data for signing.

```typescript
const { typedData, eip7702, expiresAt } = await zerodust.createAuthorization(quote.quoteId);

// typedData: EIP-712 typed data to sign (SweepIntent)
// eip7702: Contract address and nonce for EIP-7702 authorization
// expiresAt: When the authorization expires
```

### Sweep Methods

#### `submitSweep(request: SweepRequest): Promise<SweepResponse>`

Submit a signed sweep for execution.

```typescript
const sweep = await zerodust.submitSweep({
  quoteId: quote.quoteId,
  signature: '0x...',           // EIP-712 signature
  eip7702Authorization: {
    chainId: 8453,
    contractAddress: '0x...',
    nonce: 0,
    yParity: 0,
    r: '0x...',
    s: '0x...',
  },
  // Optional: For auto-revoke after sweep
  revokeAuthorization: {
    chainId: 8453,
    contractAddress: '0x0000000000000000000000000000000000000000',
    nonce: 1,
    yParity: 0,
    r: '0x...',
    s: '0x...',
  },
});

console.log('Sweep ID:', sweep.sweepId);
console.log('Status:', sweep.status);
```

#### `getSweepStatus(sweepId: string): Promise<SweepStatusResponse>`

Get the current status of a sweep.

```typescript
const status = await zerodust.getSweepStatus(sweep.sweepId);

switch (status.status) {
  case 'pending':
    console.log('Waiting to be processed...');
    break;
  case 'simulating':
    console.log('Simulating transaction...');
    break;
  case 'executing':
    console.log('Transaction submitted...');
    break;
  case 'bridging':
    console.log('Bridging to destination chain...');
    break;
  case 'completed':
    console.log('Done! TX:', status.txHash);
    break;
  case 'failed':
    console.log('Failed:', status.errorMessage);
    break;
}
```

#### `getSweeps(address: string, options?: ListSweepsOptions): Promise<SweepsListResponse>`

List sweeps for a user address.

```typescript
const { sweeps, total } = await zerodust.getSweeps('0x...', {
  limit: 10,
  offset: 0,
  status: 'completed',  // Optional filter
});

sweeps.forEach(sweep => {
  console.log(`${sweep.sweepId}: ${sweep.status}`);
});
```

#### `waitForSweep(sweepId: string, options?): Promise<SweepStatusResponse>`

Poll until sweep reaches a terminal state (completed or failed).

```typescript
const result = await zerodust.waitForSweep(sweep.sweepId, {
  intervalMs: 2000,     // Poll every 2 seconds (default)
  timeoutMs: 120000,    // Timeout after 2 minutes (default)
  onStatusChange: (status) => {
    console.log('Status changed:', status.status);
  },
});

if (result.status === 'completed') {
  console.log('Success! TX:', result.txHash);
} else {
  console.log('Failed:', result.errorMessage);
}
```

## Error Handling

All errors extend `ZeroDustError` with a machine-readable code:

```typescript
import { ZeroDustError, isZeroDustError } from '@zerodust/sdk';

try {
  await zerodust.getQuote(params);
} catch (error) {
  if (isZeroDustError(error)) {
    console.log('Error code:', error.code);
    console.log('Message:', error.message);
    console.log('User message:', error.getUserMessage());
    console.log('Details:', error.details);
    console.log('Retryable:', error.isRetryable());

    switch (error.code) {
      case 'BALANCE_TOO_LOW':
        console.log('Balance too low to sweep');
        break;
      case 'QUOTE_EXPIRED':
        console.log('Quote expired, get a new one');
        break;
      case 'CHAIN_NOT_SUPPORTED':
        console.log('Chain not supported');
        break;
      case 'NETWORK_ERROR':
        console.log('Network error, retry');
        break;
      // ... handle other codes
    }
  }
}
```

### Error Codes

| Code | Description | Retryable |
|------|-------------|-----------|
| `BALANCE_TOO_LOW` | Balance is below minimum sweep amount | No |
| `QUOTE_EXPIRED` | Quote has expired (60s lifetime) | No |
| `QUOTE_NOT_FOUND` | Quote ID not found | No |
| `CHAIN_NOT_SUPPORTED` | Chain is not supported | No |
| `INVALID_ADDRESS` | Invalid Ethereum address | No |
| `INVALID_SIGNATURE` | Signature verification failed | No |
| `INVALID_CHAIN_ID` | Invalid chain ID | No |
| `EIP7702_INVALID_SIGNATURE` | Invalid EIP-7702 authorization | No |
| `SIGNATURE_REJECTED` | User rejected signature request | No |
| `BRIDGE_UNAVAILABLE` | Bridge route not available | No |
| `SOURCE_CHAIN_DISABLED` | Source chain temporarily disabled | No |
| `DEST_CHAIN_DISABLED` | Destination chain temporarily disabled | No |
| `SIMULATION_FAILED` | Transaction simulation failed | No |
| `NETWORK_ERROR` | Network connectivity issue | Yes |
| `TIMEOUT` | Request timed out | Yes |
| `RPC_ERROR` | RPC node error | Yes |
| `SERVICE_UNAVAILABLE` | Service temporarily unavailable | Yes |
| `INTERNAL_ERROR` | Internal server error | Yes |

### Specific Error Classes

```typescript
import {
  BalanceTooLowError,
  QuoteExpiredError,
  NetworkError,
  TimeoutError,
  ChainNotSupportedError,
  InvalidAddressError,
  SignatureError,
  BridgeError,
} from '@zerodust/sdk';

try {
  await zerodust.getBalance('invalid', 8453);
} catch (error) {
  if (error instanceof InvalidAddressError) {
    console.log('Invalid address:', error.details?.address);
  }
}
```

## Utilities

The SDK exports utility functions for advanced use cases:

### Validation

```typescript
import {
  validateAddress,
  validateChainId,
  validateSignature,
  validateUuid,
  validateAmount,
  validateHex,
  validateQuoteRequest,
  validateEIP7702Authorization,
} from '@zerodust/sdk';

// Validate and normalize address (returns checksummed)
const address = validateAddress('0x...', 'userAddress');

// Validate chain ID (must be positive integer)
const chainId = validateChainId(8453);

// Validate signature (64 or 65 bytes)
const sig = validateSignature('0x...');

// Validate UUID format
const id = validateUuid('550e8400-e29b-41d4-a716-446655440000', 'quoteId');

// Validate amount (string or bigint, non-negative)
const amount = validateAmount('1000000000000000000', 'balance');
```

### EIP-712 Signature Helpers

```typescript
import {
  DOMAIN_NAME,
  DOMAIN_VERSION,
  MODE_TRANSFER,
  MODE_CALL,
  ZERO_ADDRESS,
  ZERO_ROUTE_HASH,
  SWEEP_INTENT_TYPES,
  computeRouteHash,
  buildSweepIntentTypedData,
  buildSweepIntentFromQuote,
  validateSweepIntentParams,
} from '@zerodust/sdk';

// Constants
console.log(DOMAIN_NAME);    // 'ZeroDustSweep'
console.log(DOMAIN_VERSION); // '1'
console.log(MODE_TRANSFER);  // 0 (same-chain)
console.log(MODE_CALL);      // 1 (cross-chain)

// Compute route hash for cross-chain sweeps
const routeHash = computeRouteHash('0x...');

// Build EIP-712 typed data manually
const typedData = buildSweepIntentTypedData(8453, userAddress, {
  mode: MODE_TRANSFER,
  user: userAddress,
  destination: destinationAddress,
  destinationChainId: 8453n,
  callTarget: ZERO_ADDRESS,
  routeHash: ZERO_ROUTE_HASH,
  minReceive: 900000000000000n,
  maxTotalFeeWei: 100000000000000n,
  overheadGasUnits: 100000n,
  protocolFeeGasUnits: 0n,
  extraFeeWei: 50000000000000n,
  reimbGasPriceCapWei: 1000000000n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
  nonce: 0n,
});
```

## TypeScript Types

All types are exported for use in your application:

```typescript
import type {
  // Configuration
  Environment,
  ZeroDustConfig,

  // Chain types
  Chain,
  ChainsResponse,

  // Balance types
  ChainBalance,
  BalancesResponse,

  // Quote types
  QuoteRequest,
  QuoteResponse,
  FeeBreakdown,
  SweepIntentFields,

  // Authorization types
  AuthorizationResponse,
  EIP712TypedData,
  EIP7702Authorization,

  // Sweep types
  SweepRequest,
  SweepResponse,
  SweepStatus,
  RevokeStatus,
  SweepStatusResponse,
  SweepSummary,
  ListSweepsOptions,
  SweepsListResponse,

  // Error types
  ZeroDustErrorCode,
  ApiErrorResponse,
} from '@zerodust/sdk';
```

## Supported Chains

ZeroDust supports all EVM chains with EIP-7702 support. Current mainnet chains include:

- Base (8453)
- Arbitrum (42161)
- Optimism (10)
- Polygon (137)
- BSC (56)
- Gnosis (100)
- And 20+ more...

Use `getChains()` to get the current list of supported chains.

## Fee Structure

ZeroDust charges a small service fee for sweeps:

- **Minimum fee:** $0.05 equivalent
- **Maximum fee:** $0.50 equivalent
- **Standard fee:** 5% of transferred value (between min/max)

Additionally:
- **Gas reimbursement:** Actual gas cost paid by the relayer
- **Bridge fee:** Near-zero (only destination gas for cross-chain)

Example: Sweeping $5 worth of ETH → ~$0.25 service fee + gas

## Browser Support

The SDK works in both Node.js and browser environments. For browsers, ensure your bundler handles the `viem` peer dependency correctly.

```html
<script type="module">
  import { ZeroDust } from '@zerodust/sdk';

  const zerodust = new ZeroDust({ environment: 'mainnet' });
  // ...
</script>
```

## License

MIT

## Links

- [Website](https://zerodust.xyz)
- [Documentation](https://docs.zerodust.xyz)
- [GitHub](https://github.com/zerodustxyz/zerodust)
- [Discord](https://discord.gg/zerodust)
