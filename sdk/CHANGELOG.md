# Changelog

All notable changes to the @zerodust/sdk package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.8] - 2026-10-07

### Fixed

- **Arbitrum Nova's L1 cost is allowed in the fee ceiling.** Nova charges the
  L1 cost as gas units (~6M for a sweep tx), which the API now charges in
  `extraFeeWei`; the ceiling prices it from Nova's NodeInterface, as it reads
  the OP, Scroll and Mantle oracles. Without it every Nova sweep was refused
  with `UNSAFE_QUOTE`.

## [0.5.7] - 2026-10-07

### Security

- **The Relay amount is computed locally.** The agent asked Relay for the API's
  `bridge.inputAmount`; it now computes what the contract will route (the balance
  it reads itself less the signed `maxTotalFeeWei`) and refuses a quote whose
  `inputAmount` differs, before asking Relay for anything.

## [0.5.6] - 2026-10-07

### Security

- **Relay routes: the deposit now comes from Relay to the agent.** Relay keeps a
  request's recipient on its own servers and the deposit calldata only carries an
  id, so a Relay route served by the API could not be checked before signing.
  For any route that calls a Relay contract (known by the contract, not the API's
  label), `ZeroDustAgent` now asks Relay for the deposit itself (the destination
  it set, refunds to the wallet, exactly `bridge.inputAmount`), checks Relay's
  answer (one transaction on the source chain for that amount, that recipient,
  native gas out, at least `estimatedReceive`), binds it with the new
  `bindRelayRoute()` (`POST /quote/:quoteId/relay-route`, using the quote's
  one-time `relayRouteToken`) and signs only that deposit. Relay routes now
  count as verified for `requireVerifiedRoute`. New option `relayApiUrl`;
  `requestRelayDeposit()` is exported. Needs network access to api.relay.link.
- **Native gas only: Across must be a plain ETH deposit.** Across swap routes
  (a source swap, or a destination message) are refused: Across settles a failed
  or partial swap in USDC/USDT/WETH instead of native gas. For an Across route
  the agent also reads the destination's code and refuses a contract recipient
  (Across pays a contract WETH, not ETH). The API stopped offering these routes
  on 2026-10-06.

### Added

- `QuoteResponse.bridge` and `QuoteResponse.relayRouteToken`.

## [0.5.5] - 2026-10-05

### Fixed

- **Rollup sweeps refused as "fee reserve exceeds the limit"** where L2 gas is
  nearly free and the L1 data fee is most of the cost (Scroll, Zora; any
  OP-stack chain when L1 is busy). The fee ceiling now adds an L1 data fee
  allowance that `ZeroDustAgent` reads from the chain's own oracle
  (`l1FeeAllowanceWei`: 2 KB of incompressible bytes, doubled), so the bound
  still never comes from the API. `verifySweepQuote` takes it as `l1FeeWei`.

## [0.5.4] - 2026-10-05

### Changed

- **`revokeAuthorization` is required** in `submitSweep` (and by the API since
  2026-10-05). It must delegate to address(0) on the sweep's chain with nonce =
  delegation nonce + 1; the client refuses anything else before sending. Without
  it a wallet stayed delegated to the ZeroDust contract after its sweep. The
  revoke's gas was always in the quoted fee. `ZeroDustAgent` already signed it,
  so agent users are unaffected.

## [0.5.3] - 2026-10-03

### Added

- **Endurance (648), token delivery through Fusionist's bridge.** ACE leaves as
  the ACE token on BNB Chain, and only to the sending wallet: the bridge call
  (`requestFromUser`) has no recipient. Its bridge is an allowed call target on
  Endurance; the quote check requires the destination to be the signer, BNB
  Chain, and an amount that fits in the routed value. `ENDURANCE_ROUTE` and
  `deliversOnlyToSender(fromChainId, toChainId)` let a UI say so; `deliveredToken`
  covers ACE. Default RPC for Endurance; Gas.zip is never a target there.

## [0.5.2] - 2026-10-03

### Added

- **Token delivery (Hyperlane warp routes).** Mitosis (124816) is a ZeroDust
  chain; its native MITO leaves only through Hyperlane's MITO warp route, which
  mints MITO as an ERC-20 on BNB Chain. The router is an allowed call target on
  Mitosis, and the quote check decodes `transferRemote` and requires the BNB
  Chain domain, the requested recipient and an amount that fits in the routed
  value. `deliveredToken(fromChainId, toChainId)` and `HYPERLANE_ROUTES` tell a
  UI the user receives that token, not gas; quotes carry `receiveToken`.
- Default RPC for Mitosis. Gas.zip is never an allowed target there.

## [0.5.1] - 2026-10-02

### Added

- Doma (97477): a ZeroDust chain since 2026-10-02. Relay's depository is an
  allowed call target there (Gas.zip does not serve Doma), and the agent has a
  default RPC for it.

## [0.5.0] - 2026-10-01

### Fixed

- **`ZeroDustAgent` works on every chain the API serves.** It shipped default
  RPCs for only 25 of the 45 chains, so sweeping any of the other 20 failed
  unless the caller passed `rpcUrls`. Every API chain now has a default
  (exported as `DEFAULT_RPC_URLS`); `rpcUrls` still overrides per chain.
- **HTTP errors get accurate codes.** A 404 used to surface as a retryable
  `INTERNAL_ERROR` and a 429 was not retried. New codes `NOT_FOUND`,
  `RATE_LIMITED` (retryable), `INVALID_REQUEST` and `UNAUTHORIZED` are mapped
  from the status when the API sends no code (`codeForStatus`).

### Added

- The client retries a 429 on any request, waiting for `Retry-After` (capped at
  30 seconds) or backing off, and retries 502/503/504 on GET requests.
- `waitForSweep()` keeps polling through retryable errors until its timeout.

### Changed

- `getChain()` for an unknown chain throws `NOT_FOUND` (it was documented as
  `ChainNotSupportedError` but threw `INTERNAL_ERROR`). Code that matched on
  `INTERNAL_ERROR` for a 404 or 429 should match the new codes.

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
