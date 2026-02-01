/**
 * @fileoverview TypeScript types for the ZeroDust SDK
 *
 * This module exports all public types used by the SDK.
 * Types match the ZeroDust backend API responses.
 */

import type { Address, Hex } from 'viem';

// ============ Configuration ============

/**
 * SDK environment - determines which API endpoint to use
 */
export type Environment = 'mainnet' | 'testnet';

/**
 * SDK configuration options
 */
export interface ZeroDustConfig {
  /** Environment: 'mainnet' or 'testnet' */
  environment?: Environment;
  /** Optional partner API key */
  apiKey?: string;
  /** Custom API base URL (overrides environment default) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Number of retries for failed requests (default: 3) */
  retries?: number;
}

// ============ Chain Types ============

/**
 * Supported blockchain chain information
 */
export interface Chain {
  /** Chain ID (e.g., 1 for Ethereum, 8453 for Base) */
  chainId: number;
  /** Human-readable chain name */
  name: string;
  /** Native token symbol (e.g., 'ETH', 'POL') */
  nativeToken: string;
  /** Native token decimals (typically 18) */
  nativeTokenDecimals: number;
  /** Minimum balance required for sweep (wei string) */
  minBalance: string;
  /** ZeroDust contract address on this chain */
  contractAddress: Address;
  /** Block explorer URL */
  explorerUrl: string;
  /** Whether the chain is currently enabled */
  enabled: boolean;
}

/**
 * Response from getChains()
 */
export interface ChainsResponse {
  chains: Chain[];
}

// ============ Balance Types ============

/**
 * Balance information for a single chain
 */
export interface ChainBalance {
  /** Chain ID */
  chainId: number;
  /** Chain name */
  name: string;
  /** Native token symbol */
  nativeToken: string;
  /** Raw balance in wei (string) */
  balance: string;
  /** Formatted balance with decimals */
  balanceFormatted: string;
  /** Whether balance is sufficient for sweep */
  canSweep: boolean;
  /** Minimum balance required (wei string) */
  minBalance: string;
}

/**
 * Response from getBalances()
 */
export interface BalancesResponse {
  /** User's address */
  address: Address;
  /** Balances across all chains */
  chains: ChainBalance[];
}

// ============ Quote Types ============

/**
 * Parameters for requesting a quote
 */
export interface QuoteRequest {
  /** Source chain ID */
  fromChainId: number;
  /** Destination chain ID (same as fromChainId for same-chain) */
  toChainId: number;
  /** User's address to sweep from */
  userAddress: Address;
  /** Destination address for swept funds */
  destination: Address;
}

/**
 * Fee breakdown in the quote
 */
export interface FeeBreakdown {
  /** Gas overhead in gas units */
  overheadGasUnits: string;
  /** Protocol fee in gas units (deprecated, always 0) */
  protocolFeeGasUnits: string;
  /** Extra fee in wei (includes service fee) */
  extraFeeWei: string;
  /** Maximum gas price for reimbursement (wei) */
  reimbGasPriceCapWei: string;
  /** Maximum total fee user can pay (wei) */
  maxTotalFeeWei: string;
  /** Gas for auto-revoke transaction */
  revokeGasUnits: string;
}

/**
 * Intent fields to sign
 */
export interface SweepIntentFields {
  /** Mode: 0 = transfer (same-chain), 1 = call (cross-chain) */
  mode: number;
  /** Destination address */
  destination: Address;
  /** Destination chain ID (string for EIP-712) */
  destinationChainId: string;
  /** Bridge call target (address(0) for same-chain) */
  callTarget: Address;
  /** Route hash (keccak256 of callData for cross-chain) */
  routeHash: Hex;
  /** Minimum amount to receive (wei string) */
  minReceive: string;
}

/**
 * Quote response from the API
 */
export interface QuoteResponse {
  /** Unique quote ID */
  quoteId: string;
  /** API version */
  version: number;
  /** User's current balance (wei string) */
  userBalance: string;
  /** Estimated amount user will receive (wei string) */
  estimatedReceive: string;
  /** Mode: 0 = transfer, 1 = call */
  mode: number;
  /** Fee breakdown */
  fees: FeeBreakdown;
  /** Whether auto-revoke is enabled */
  autoRevoke: boolean;
  /** Intent fields for signing */
  intent: SweepIntentFields;
  /** Quote deadline (unix timestamp) */
  deadline: number;
  /** Contract nonce for sweep intent */
  nonce: number;
  /** Transaction nonce for EIP-7702 authorization */
  authNonce: number;
  /** Seconds until quote expires */
  validForSeconds: number;
}

// ============ Authorization Types ============

/**
 * EIP-712 typed data for signing
 */
export interface EIP712TypedData {
  types: {
    EIP712Domain: Array<{ name: string; type: string }>;
    SweepIntent: Array<{ name: string; type: string }>;
  };
  primaryType: 'SweepIntent';
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
  };
  message: Record<string, unknown>;
}

/**
 * Response from createAuthorization()
 */
export interface AuthorizationResponse {
  /** Sweep type */
  sweepType: 'same-chain' | 'cross-chain';
  /** EIP-712 typed data to sign */
  typedData: EIP712TypedData;
  /** Contract address for EIP-7702 delegation */
  contractAddress: Address;
  /** API version */
  version: number;
}

// ============ EIP-7702 Authorization ============

/**
 * EIP-7702 authorization object
 */
export interface EIP7702Authorization {
  /** Chain ID */
  chainId: number;
  /** Contract address to delegate to */
  contractAddress: Address;
  /** Transaction nonce */
  nonce: number;
  /** Y parity (0 or 1) */
  yParity: 0 | 1;
  /** R component of signature */
  r: Hex;
  /** S component of signature */
  s: Hex;
}

// ============ Sweep Types ============

/**
 * Request to submit a sweep
 */
export interface SweepRequest {
  /** Quote ID from getQuote() */
  quoteId: string;
  /** EIP-712 signature of the sweep intent */
  signature: Hex;
  /** EIP-7702 delegation authorization */
  eip7702Authorization: EIP7702Authorization;
  /** Optional: EIP-7702 revoke authorization (for auto-revoke) */
  revokeAuthorization?: EIP7702Authorization;
}

/**
 * Response from submitSweep()
 */
export interface SweepResponse {
  /** Unique sweep ID */
  sweepId: string;
  /** Current status */
  status: SweepStatus;
  /** Sweep type */
  sweepType: 'same-chain' | 'cross-chain';
  /** Whether this was an existing sweep (idempotent) */
  isExisting: boolean;
  /** API version */
  version: number;
}

/**
 * Sweep status values
 */
export type SweepStatus =
  | 'pending'
  | 'simulating'
  | 'executing'
  | 'broadcasted'
  | 'bridging'
  | 'completed'
  | 'failed';

/**
 * Revoke status values
 */
export type RevokeStatus =
  | 'not_requested'
  | 'pending'
  | 'executing'
  | 'completed'
  | 'failed';

/**
 * Detailed sweep status response
 */
export interface SweepStatusResponse {
  /** Unique sweep ID */
  sweepId: string;
  /** Current status */
  status: SweepStatus;
  /** Sweep type */
  sweepType: 'same-chain' | 'cross-chain';
  /** Mode: 0 = transfer, 1 = call */
  mode: number;
  /** Transaction hash (if submitted) */
  txHash?: string;
  /** Destination transaction hash (for cross-chain) */
  destinationTxHash?: string;
  /** Amount sent (wei string) */
  amountSent?: string;
  /** Destination address */
  destination: Address;
  /** Source chain ID */
  fromChainId: number;
  /** Destination chain ID */
  toChainId: number;
  /** Error message (if failed) */
  errorMessage?: string;
  /** Bridge tracking URL (for cross-chain) */
  bridgeTrackingUrl?: string;
  /** API version */
  version: number;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Revoke status (for auto-revoke) */
  revokeStatus?: RevokeStatus;
  /** Revoke transaction hash */
  revokeTxHash?: string;
  /** Revoke error message */
  revokeError?: string;
}

/**
 * Summary of a sweep for listing
 */
export interface SweepSummary {
  /** Unique sweep ID */
  sweepId: string;
  /** Current status */
  status: SweepStatus;
  /** Sweep type */
  sweepType: 'same-chain' | 'cross-chain';
  /** Mode: 0 = transfer, 1 = call */
  mode: number;
  /** Source chain ID */
  fromChainId: number;
  /** Destination chain ID */
  toChainId: number;
  /** Amount sent (wei string) */
  amountSent?: string;
  /** Transaction hash */
  txHash?: string;
  /** API version */
  version: number;
  /** Creation timestamp */
  createdAt: string;
}

/**
 * Options for listing sweeps
 */
export interface ListSweepsOptions {
  /** Maximum number of results (default: 20, max: 100) */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by status */
  status?: SweepStatus;
}

/**
 * Response from getSweeps()
 */
export interface SweepsListResponse {
  /** List of sweeps */
  sweeps: SweepSummary[];
  /** Total count (for pagination) */
  total: number;
}

// ============ Error Types ============

/**
 * API error codes
 */
export type ZeroDustErrorCode =
  // User errors
  | 'BALANCE_TOO_LOW'
  | 'QUOTE_EXPIRED'
  | 'SIGNATURE_REJECTED'
  | 'INVALID_ADDRESS'
  | 'INVALID_CHAIN_ID'
  | 'CHAIN_NOT_SUPPORTED'
  | 'INSUFFICIENT_FOR_FEES'
  // Network errors
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'RPC_ERROR'
  // System errors
  | 'CHAIN_PAUSED'
  | 'SOURCE_CHAIN_DISABLED'
  | 'DEST_CHAIN_DISABLED'
  | 'BRIDGE_UNAVAILABLE'
  | 'CONTRACT_NOT_DEPLOYED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  // Validation errors
  | 'INVALID_SIGNATURE'
  | 'EIP7702_INVALID_SIGNATURE'
  | 'CHAIN_ID_MISMATCH'
  | 'NONCE_MISMATCH'
  | 'MISSING_CALL_DATA'
  | 'QUOTE_NOT_FOUND';

/**
 * API error response
 */
export interface ApiErrorResponse {
  error: string;
  code?: ZeroDustErrorCode;
}
