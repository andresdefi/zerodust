/**
 * @fileoverview Error handling for the ZeroDust SDK
 *
 * All SDK errors extend ZeroDustError and include:
 * - A machine-readable error code
 * - A human-readable message
 * - Optional details for debugging
 */

import type { ZeroDustErrorCode } from './types.js';

/**
 * Base error class for all ZeroDust SDK errors
 */
export class ZeroDustError extends Error {
  /** Machine-readable error code */
  readonly code: ZeroDustErrorCode;
  /** Additional details for debugging */
  readonly details?: Record<string, unknown>;
  /** HTTP status code (if from API) */
  readonly statusCode?: number;

  constructor(
    code: ZeroDustErrorCode,
    message: string,
    details?: Record<string, unknown>,
    statusCode?: number
  ) {
    super(message);
    this.name = 'ZeroDustError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
    if (statusCode !== undefined) {
      this.statusCode = statusCode;
    }

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ZeroDustError);
    }
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(): string {
    return ERROR_MESSAGES[this.code] ?? this.message;
  }

  /**
   * Check if error is retryable
   */
  isRetryable(): boolean {
    return RETRYABLE_ERRORS.has(this.code);
  }

  /**
   * Convert to plain object (useful for logging)
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.getUserMessage(),
      details: this.details,
      statusCode: this.statusCode,
      retryable: this.isRetryable(),
    };
  }
}

/**
 * Error thrown when balance is too low for sweep
 */
export class BalanceTooLowError extends ZeroDustError {
  constructor(
    minBalance: string,
    currentBalance?: string,
    details?: Record<string, unknown>
  ) {
    super(
      'BALANCE_TOO_LOW',
      `Balance too low for sweep. Minimum required: ${minBalance}`,
      { minBalance, currentBalance, ...details }
    );
    this.name = 'BalanceTooLowError';
  }
}

/**
 * Error thrown when a quote has expired
 */
export class QuoteExpiredError extends ZeroDustError {
  constructor(quoteId: string, details?: Record<string, unknown>) {
    super(
      'QUOTE_EXPIRED',
      'Quote has expired. Please request a new quote.',
      { quoteId, ...details }
    );
    this.name = 'QuoteExpiredError';
  }
}

/**
 * Error thrown for network-related issues
 */
export class NetworkError extends ZeroDustError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('NETWORK_ERROR', message, details);
    this.name = 'NetworkError';
  }
}

/**
 * Error thrown when request times out
 */
export class TimeoutError extends ZeroDustError {
  constructor(timeoutMs: number, details?: Record<string, unknown>) {
    super(
      'TIMEOUT',
      `Request timed out after ${timeoutMs}ms`,
      { timeoutMs, ...details }
    );
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when chain is not supported
 */
export class ChainNotSupportedError extends ZeroDustError {
  constructor(chainId: number, details?: Record<string, unknown>) {
    super(
      'CHAIN_NOT_SUPPORTED',
      `Chain ${chainId} is not supported`,
      { chainId, ...details }
    );
    this.name = 'ChainNotSupportedError';
  }
}

/**
 * Error thrown for invalid addresses
 */
export class InvalidAddressError extends ZeroDustError {
  constructor(address: string, fieldName?: string, details?: Record<string, unknown>) {
    const field = fieldName ? ` for ${fieldName}` : '';
    super(
      'INVALID_ADDRESS',
      `Invalid Ethereum address${field}: ${address}`,
      { address, fieldName, ...details }
    );
    this.name = 'InvalidAddressError';
  }
}

/**
 * Error thrown for signature-related issues
 */
export class SignatureError extends ZeroDustError {
  constructor(
    code: 'INVALID_SIGNATURE' | 'EIP7702_INVALID_SIGNATURE' | 'SIGNATURE_REJECTED',
    message: string,
    details?: Record<string, unknown>
  ) {
    super(code, message, details);
    this.name = 'SignatureError';
  }
}

/**
 * Error thrown when bridge is unavailable
 */
export class BridgeError extends ZeroDustError {
  constructor(
    code: 'BRIDGE_UNAVAILABLE' | 'SOURCE_CHAIN_DISABLED' | 'DEST_CHAIN_DISABLED',
    message: string,
    details?: Record<string, unknown>
  ) {
    super(code, message, details);
    this.name = 'BridgeError';
  }
}

// ============ User-Friendly Error Messages ============

/**
 * Map of error codes to user-friendly messages
 */
const ERROR_MESSAGES: Record<ZeroDustErrorCode, string> = {
  // User errors
  BALANCE_TOO_LOW: 'Your balance is too low to sweep.',
  QUOTE_EXPIRED: 'Quote expired. Getting a fresh quote...',
  SIGNATURE_REJECTED: 'Signature cancelled.',
  INVALID_ADDRESS: 'Invalid wallet address.',
  INVALID_CHAIN_ID: 'Invalid chain selected.',
  CHAIN_NOT_SUPPORTED: 'This chain is not yet supported.',
  INSUFFICIENT_FOR_FEES: 'Balance too low to cover fees.',

  // Network errors
  NETWORK_ERROR: 'Network error. Please check your connection.',
  TIMEOUT: 'Request timed out. Please try again.',
  RPC_ERROR: 'Blockchain connection error. Please try again.',

  // System errors
  CHAIN_PAUSED: 'This chain is temporarily unavailable. Please try another.',
  SOURCE_CHAIN_DISABLED: 'Cross-chain sweeps from this chain are temporarily unavailable.',
  DEST_CHAIN_DISABLED: 'Cross-chain sweeps to this chain are temporarily unavailable.',
  BRIDGE_UNAVAILABLE: 'Bridge route not available. Try a different destination.',
  CONTRACT_NOT_DEPLOYED: 'ZeroDust is not available on this chain.',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable. Please try again later.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',

  // Validation errors
  INVALID_SIGNATURE: 'Signature verification failed. Please try signing again.',
  EIP7702_INVALID_SIGNATURE: 'Authorization signature is invalid.',
  CHAIN_ID_MISMATCH: 'Wrong network selected in your wallet.',
  NONCE_MISMATCH: 'Transaction nonce mismatch. Please try again.',
  MISSING_CALL_DATA: 'Missing bridge data. Please try getting a new quote.',
  QUOTE_NOT_FOUND: 'Quote not found. Please request a new quote.',
};

/**
 * Set of error codes that are retryable
 */
const RETRYABLE_ERRORS = new Set<ZeroDustErrorCode>([
  'NETWORK_ERROR',
  'TIMEOUT',
  'RPC_ERROR',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
]);

/**
 * Create a ZeroDustError from an API error response
 */
export function createErrorFromResponse(
  statusCode: number,
  errorResponse: { error: string; code?: string }
): ZeroDustError {
  const code = (errorResponse.code ?? 'INTERNAL_ERROR') as ZeroDustErrorCode;
  const message = errorResponse.error;

  return new ZeroDustError(code, message, { rawError: errorResponse }, statusCode);
}

/**
 * Check if an error is a ZeroDustError
 */
export function isZeroDustError(error: unknown): error is ZeroDustError {
  return error instanceof ZeroDustError;
}

/**
 * Wrap unknown errors in a ZeroDustError
 */
export function wrapError(error: unknown, context?: string): ZeroDustError {
  if (isZeroDustError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const message = context ? `${context}: ${error.message}` : error.message;

    // Check for common network errors
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      return new TimeoutError(30000, { originalError: error.message });
    }

    if (error.message.includes('fetch') || error.message.includes('network')) {
      return new NetworkError(message, { originalError: error.message });
    }

    return new ZeroDustError('INTERNAL_ERROR', message, { originalError: error.message });
  }

  const message = context ?? 'An unexpected error occurred';
  return new ZeroDustError('INTERNAL_ERROR', message, { originalError: String(error) });
}
