/**
 * @fileoverview ZeroDust SDK
 *
 * TypeScript SDK for ZeroDust - sweep native gas tokens to zero.
 *
 * @example
 * ```typescript
 * import { ZeroDust } from '@zerodust/sdk';
 *
 * const zerodust = new ZeroDust({ environment: 'mainnet' });
 *
 * // Get user balances
 * const balances = await zerodust.getBalances('0x1234...');
 *
 * // Get a quote
 * const quote = await zerodust.getQuote({
 *   fromChainId: 42161,
 *   toChainId: 8453,
 *   userAddress: '0x1234...',
 *   destination: '0x5678...',
 * });
 *
 * // Create authorization for signing
 * const { typedData } = await zerodust.createAuthorization(quote.quoteId);
 *
 * // Submit signed sweep
 * const sweep = await zerodust.submitSweep({
 *   quoteId: quote.quoteId,
 *   signature: '0x...',
 *   eip7702Authorization: {...},
 * });
 *
 * // Wait for completion
 * const status = await zerodust.waitForSweep(sweep.sweepId);
 * ```
 *
 * @packageDocumentation
 */

// Main client
export { ZeroDust } from './client.js';

// Types
export type {
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
} from './types.js';

// Errors
export {
  ZeroDustError,
  BalanceTooLowError,
  QuoteExpiredError,
  NetworkError,
  TimeoutError,
  ChainNotSupportedError,
  InvalidAddressError,
  SignatureError,
  BridgeError,
  createErrorFromResponse,
  isZeroDustError,
  wrapError,
} from './errors.js';

// Utilities
export {
  // Validation
  validateAddress,
  validateChainId,
  validateSignature,
  validateUuid,
  validateAmount,
  validateQuoteRequest,
  validateEIP7702Authorization,
  validateSupportedChain,
  validateHex,
} from './utils/validation.js';

export {
  // Signature utilities
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
  type SweepIntentParams,
} from './utils/signature.js';
