# Changelog

All notable changes to the @zerodust/sdk package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-07-25

### Added

- `dryRun` option on `AgentSweepOptions`. When set, `sweep()`, `batchSweep()`
  and `sweepAll()` run the full flow — quote, EIP-712 typed data, and all three
  signatures — and then stop before submitting. Nothing is broadcast and no
  balance changes, so an integration can be proven end to end without risking
  funds.
- `AgentSweepResult.dryRun` and `AgentSweepResult.signatures`, so a dry run can
  be inspected and verified rather than merely trusted.

## [0.1.0] - 2026-02-01

### Added

- Initial release of the ZeroDust SDK
- Core `ZeroDust` client class with all API methods:
  - `getChains()` / `getChain()` - Fetch supported chains
  - `getBalances()` / `getBalance()` - Fetch user balances
  - `getQuote()` - Get sweep quotes with fee breakdown
  - `createAuthorization()` - Generate EIP-712 typed data for signing
  - `submitSweep()` - Submit signed sweep for execution
  - `getSweepStatus()` / `getSweeps()` - Track sweep status
  - `waitForSweep()` - Poll until sweep completion
- Comprehensive error handling with `ZeroDustError` base class
- Specific error classes: `BalanceTooLowError`, `QuoteExpiredError`, `NetworkError`, `TimeoutError`, `ChainNotSupportedError`, `InvalidAddressError`, `SignatureError`, `BridgeError`
- Input validation utilities: `validateAddress`, `validateChainId`, `validateSignature`, `validateUuid`, `validateAmount`, `validateHex`
- EIP-712 signature utilities: `buildSweepIntentTypedData`, `buildSweepIntentFromQuote`, `computeRouteHash`
- Full TypeScript support with exported types
- ESM and CommonJS dual package support
- Automatic retry logic with exponential backoff
- Chain response caching (1 minute TTL)

### Security

- All inputs validated before API calls
- EIP-7702 authorization validation
- Signature format validation (64/65 bytes)
