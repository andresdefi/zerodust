# ZeroDust API Reference

Base URL: `https://api.zerodust.xyz`

API docs with Swagger UI: `https://api.zerodust.xyz/docs`

## Core Endpoints

### GET /balances/:address

Check native token balances across all supported chains.

**Query params:** `testnet` (boolean, default: true)

**Response:**
```json
{
  "address": "0x...",
  "chains": [
    {
      "chainId": 42161,
      "name": "Arbitrum",
      "nativeToken": "ETH",
      "balance": "800000000000000",
      "balanceFormatted": "0.0008",
      "canSweep": true,
      "minBalance": "10000000000000"
    }
  ]
}
```

### GET /balances/:address/:chainId

Check balance on a specific chain.

### GET /chains

List all supported chains.

**Query params:** `testnet` (boolean, default: true)

### GET /quote

Get a quote for sweeping. This is the first step in the sweep flow.

**Query params (all required):**
- `fromChainId` - Source chain ID
- `toChainId` - Destination chain ID (same as source for same-chain)
- `userAddress` - Address to sweep from
- `destination` - Address to receive funds

**Response:**
```json
{
  "quoteId": "uuid",
  "version": 3,
  "userBalance": "800000000000000",
  "estimatedReceive": "750000000000000",
  "mode": 0,
  "fees": {
    "overheadGasUnits": "100000",
    "protocolFeeGasUnits": "0",
    "extraFeeWei": "50000000000000",
    "reimbGasPriceCapWei": "120000000",
    "maxTotalFeeWei": "62000000000000",
    "revokeGasUnits": "50000"
  },
  "autoRevoke": true,
  "intent": {
    "mode": 0,
    "destination": "0x...",
    "destinationChainId": "8453",
    "callTarget": "0x0000000000000000000000000000000000000000",
    "routeHash": "0x0000...0000",
    "minReceive": "712500000000000"
  },
  "deadline": 1706400055,
  "nonce": 0,
  "authNonce": 5,
  "validForSeconds": 55
}
```

**Mode values:** `0` = MODE_TRANSFER (same-chain), `1` = MODE_CALL (cross-chain via bridge)

### POST /authorization

Get EIP-712 typed data for signing. Call this after getting a quote.

**Body:** `{ "quoteId": "uuid" }`

**Response:**
```json
{
  "sweepType": "same-chain",
  "typedData": {
    "domain": {
      "name": "ZeroDustSweep",
      "version": "3",
      "chainId": 42161,
      "verifyingContract": "0x..."
    },
    "types": { "SweepIntent": [...] },
    "primaryType": "SweepIntent",
    "message": { ... }
  },
  "contractAddress": "0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2",
  "version": 3
}
```

**Important:** `verifyingContract` is the user's EOA address (EIP-7702), not the contract address.

### POST /sweep

Submit signed authorization to execute the sweep.

**Body:**
```json
{
  "quoteId": "uuid",
  "signature": "0x...",
  "eip7702Authorization": {
    "chainId": 42161,
    "contractAddress": "0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2",
    "nonce": 5,
    "yParity": 0,
    "r": "0x...",
    "s": "0x..."
  },
  "revokeAuthorization": {
    "chainId": 42161,
    "contractAddress": "0x0000000000000000000000000000000000000000",
    "nonce": 6,
    "yParity": 1,
    "r": "0x...",
    "s": "0x..."
  }
}
```

**Response:**
```json
{
  "sweepId": "uuid",
  "status": "pending",
  "sweepType": "same-chain",
  "isExisting": false,
  "version": 3
}
```

**Notes:**
- `eip7702Authorization` delegates the user's EOA to the ZeroDust contract
- `revokeAuthorization` (optional but recommended) auto-revokes delegation after sweep
- Revoke nonce must be delegation nonce + 1
- Endpoint is idempotent (returns existing sweep if quoteId already submitted)

### GET /sweep/:sweepId

Check sweep status.

**Response:**
```json
{
  "sweepId": "uuid",
  "status": "completed",
  "sweepType": "same-chain",
  "mode": 0,
  "txHash": "0x...",
  "amountSent": "750000000000000",
  "destination": "0x...",
  "fromChainId": 42161,
  "toChainId": 8453,
  "revokeStatus": "completed",
  "revokeTxHash": "0x..."
}
```

**Sweep statuses:** `pending` -> `simulating` -> `executing` -> `broadcasted` -> `bridging` (cross-chain only) -> `completed` | `failed`

### GET /sweeps/:address

List sweeps for a user. Supports `limit`, `offset`, and `status` query params.

## Agent Endpoints

These require an API key via `Authorization: Bearer <key>` or `X-API-Key: <key>`.

### POST /agent/register

Register and get an API key. Rate limits: 300/min, 1000/day.

### POST /agent/sweep

Combined quote + authorization data in one call. Returns quote, typed data, and EIP-7702 params.

### POST /agent/batch-sweep

Process multiple chains in one request. Returns results array with individual success/failure.

### GET /agent/me

Get API key info and usage stats.

### DELETE /agent/key

Self-revoke API key (cannot be undone).

## Error Codes

| Code | Meaning |
|------|---------|
| `BALANCE_TOO_LOW` | Balance below minimum for sweep |
| `INSUFFICIENT_FOR_FEES` | Balance doesn't cover fees |
| `QUOTE_EXPIRED` | Quote deadline passed |
| `INVALID_SIGNATURE` | EIP-712 signature verification failed |
| `EIP7702_INVALID_SIGNATURE` | EIP-7702 authorization signature invalid |
| `CHAIN_ID_MISMATCH` | Authorization chain doesn't match quote |
| `CONTRACT_NOT_DEPLOYED` | No contract on requested chain |
| `SOURCE_CHAIN_DISABLED` | Bridge temporarily disabled for source |
| `DEST_CHAIN_DISABLED` | Bridge temporarily disabled for destination |

## MCP Server

Endpoint: `POST https://api.zerodust.xyz/mcp`

Protocol: JSON-RPC 2.0 (MCP spec version 2024-11-05)

### Available Tools

- **check_balances** `{address}` - Balances across all chains
- **get_sweep_quote** `{userAddress, sourceChainId, destinationChainId, destinationAddress}` - Quote
- **get_supported_chains** `{}` - Chain list
- **get_service_info** `{}` - Pricing, features, integration details

### Example MCP Call

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "check_balances",
    "arguments": {
      "address": "0x1234567890abcdef1234567890abcdef12345678"
    }
  }
}
```
