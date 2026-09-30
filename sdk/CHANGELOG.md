# Changelog

All notable changes to the @zerodust/sdk package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-09-30

### Security

The agent no longer trusts the ZeroDust API with what it signs. Before, it
signed whatever EIP-712 domain, types and message `POST /authorization`
returned and delegated the account to whatever `contractAddress` it named, so a
compromised or impersonated API could have taken the whole balance.

- **Delegation target is hardcoded.** The EIP-7702 delegation is signed only
  for the ZeroDust contract `0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2`; an
  API response naming anything else is refused. The signed delegation and
  revoke are checked (target, chain, nonce) before they leave the SDK.
- **Typed data is built locally.** The SweepIntent is built from a hardcoded
  domain (`ZeroDust`, `3`, the source chain, `verifyingContract` = the signer)
  and the contract's exact type. The API's typed data is compared, never signed.
- **The signed intent must match the request.** `user` is the signer; the
  destination and destination chain are the ones asked for; same-chain is a
  plain transfer (mode 0, no call target, empty route); cross-chain is a bridge
  call (mode 1) to a contract in a per-chain allowlist of Gas.zip, Relay and
  Across deposit contracts. Gas.zip route calldata is rebuilt from Gas.zip's own
  chain map and must hash to the signed `routeHash`, which binds the recipient.
  If the API returns `intent.callData`, its hash must match, Across deposits
  are decoded (recipient, depositor, destination chain) and a Relay deposit
  must credit the signer.
- **Fee, gas price and deadline bounds.** The fee reserve must be at most
  1.5M gas units at the signed gas price cap plus 5% of the balance read from
  the caller's RPC (not the quote), below the balance, with `extraFeeWei` inside
  it; the gas price cap at most 3x the locally read gas price; overhead and
  protocol fee units within the contract maxima; the deadline in the future and
  at most 60s (+10s clock skew) away.
- Any failed check throws `UNSAFE_QUOTE` (a new error code) before anything is
  signed, dry runs included.

### Added

- `requireVerifiedRoute` agent option: refuse cross-chain routes whose recipient
  cannot be verified locally (Relay always, Across until the API returns its
  calldata). Off by default.
- `verifySweepQuote()`, `assertAuthorizationMatches()`,
  `assertSignedAuthorization()` and the bridge allowlist helpers
  (`bridgeForCallTarget`, `allowedCallTargets`, `buildGasZipDepositCalldata`,
  `createGasZipChainShortResolver`) for integrations that sign themselves.
- `ZERODUST_CONTRACT_ADDRESS`.

### Fixed

- `DOMAIN_NAME` / `DOMAIN_VERSION` were `'ZeroDustSweep'` / `'1'`, a domain the
  deployed contract never verifies against. They are now `'ZeroDust'` / `'3'`,
  so `buildSweepIntentTypedData()` produces signatures the contract accepts.

## [0.3.0] - 2026-09-29

### Added

- `getDestinations(fromChainId)`: the chains a cross-chain sweep can deliver
  native gas to, with the native token received there. Destinations are no
  longer limited to ZeroDust chains; any EVM chain a bridge serves qualifies
  (HyperEVM, Avalanche, zkSync Era, Monad, ...). `getQuote` already accepted
  any destination chain ID.
- `Destination` and `DestinationsResponse` types.

## [0.2.1] - 2026-09-27

### Fixed

- **Sweeps on 18 of the 25 supported chains signed an unusable EIP-7702
  authorization.** The agent knew public RPCs for only seven chains and fell
  back to an Ethereum RPC for the rest, so it read the account's *Ethereum*
  nonce. The authorization was well-formed but could never apply, and the sweep
  failed on-chain. Default RPCs now come from viem's chain definitions for every
  chain the API serves.
- An unknown chain with no `rpcUrls` entry now throws `CHAIN_NOT_SUPPORTED`
  instead of silently signing against Ethereum.
- The signed delegation nonce is checked against the quote's `authNonce`; a
  mismatch throws `NONCE_MISMATCH` before anything is submitted, so any future
  wrong-RPC or stale-nonce problem fails loudly and for free.

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
