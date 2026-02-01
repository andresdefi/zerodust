/**
 * @fileoverview Input validation utilities for the ZeroDust SDK
 *
 * Validates user inputs before sending to the API.
 * All validation functions throw InvalidAddressError or appropriate errors.
 */

import { isAddress, isHex, getAddress, type Address, type Hex } from 'viem';
import { InvalidAddressError, ZeroDustError, ChainNotSupportedError } from '../errors.js';

/**
 * Validate and normalize an Ethereum address
 *
 * @param address - Address to validate
 * @param fieldName - Field name for error messages
 * @returns Checksummed address
 * @throws {InvalidAddressError} If address is invalid
 *
 * @example
 * const normalized = validateAddress('0x1234...', 'userAddress');
 */
export function validateAddress(address: string, fieldName?: string): Address {
  if (!address || typeof address !== 'string') {
    throw new InvalidAddressError(address ?? 'undefined', fieldName);
  }

  const trimmed = address.trim();

  // Use strict: false to accept all-lowercase or all-uppercase addresses
  // getAddress will normalize to proper checksum
  if (!isAddress(trimmed, { strict: false })) {
    throw new InvalidAddressError(address, fieldName);
  }

  return getAddress(trimmed);
}

/**
 * Validate a chain ID
 *
 * @param chainId - Chain ID to validate
 * @returns Validated chain ID
 * @throws {ZeroDustError} If chain ID is invalid
 *
 * @example
 * const id = validateChainId(8453); // Base
 */
export function validateChainId(chainId: unknown): number {
  if (typeof chainId !== 'number' || !Number.isInteger(chainId) || chainId <= 0) {
    throw new ZeroDustError(
      'INVALID_CHAIN_ID',
      `Invalid chain ID: ${chainId}. Must be a positive integer.`,
      { chainId }
    );
  }

  return chainId;
}

/**
 * Validate chain ID is in list of supported chains
 *
 * @param chainId - Chain ID to validate
 * @param supportedChainIds - Set of supported chain IDs
 * @throws {ChainNotSupportedError} If chain is not supported
 */
export function validateSupportedChain(
  chainId: number,
  supportedChainIds: Set<number>
): void {
  if (!supportedChainIds.has(chainId)) {
    throw new ChainNotSupportedError(chainId);
  }
}

/**
 * Validate a hex string (for signatures, hashes, etc.)
 *
 * @param value - Value to validate
 * @param fieldName - Field name for error messages
 * @param expectedBytes - Expected byte length (optional)
 * @returns Validated hex string
 * @throws {ZeroDustError} If not valid hex
 *
 * @example
 * const sig = validateHex(signature, 'signature', 65);
 */
export function validateHex(
  value: string,
  fieldName: string,
  expectedBytes?: number
): Hex {
  if (!value || typeof value !== 'string') {
    throw new ZeroDustError(
      'INVALID_SIGNATURE',
      `${fieldName} must be a valid hex string`,
      { value, fieldName }
    );
  }

  const trimmed = value.trim();

  if (!isHex(trimmed)) {
    throw new ZeroDustError(
      'INVALID_SIGNATURE',
      `${fieldName} must be a valid hex string starting with 0x`,
      { value: trimmed, fieldName }
    );
  }

  if (expectedBytes !== undefined) {
    const actualBytes = (trimmed.length - 2) / 2;
    if (actualBytes !== expectedBytes) {
      throw new ZeroDustError(
        'INVALID_SIGNATURE',
        `${fieldName} must be ${expectedBytes} bytes, got ${actualBytes}`,
        { value: trimmed, fieldName, expectedBytes, actualBytes }
      );
    }
  }

  return trimmed as Hex;
}

/**
 * Validate an EIP-712 signature (64 or 65 bytes)
 *
 * @param signature - Signature to validate
 * @returns Validated signature
 * @throws {ZeroDustError} If signature format is invalid
 */
export function validateSignature(signature: string): Hex {
  if (!signature || typeof signature !== 'string') {
    throw new ZeroDustError(
      'INVALID_SIGNATURE',
      'Signature is required',
      { signature }
    );
  }

  const trimmed = signature.trim();

  if (!isHex(trimmed)) {
    throw new ZeroDustError(
      'INVALID_SIGNATURE',
      'Signature must be a valid hex string',
      { signature: trimmed }
    );
  }

  const bytes = (trimmed.length - 2) / 2;
  if (bytes !== 64 && bytes !== 65) {
    throw new ZeroDustError(
      'INVALID_SIGNATURE',
      `Signature must be 64 or 65 bytes, got ${bytes}`,
      { signature: trimmed, bytes }
    );
  }

  return trimmed as Hex;
}

/**
 * Validate a UUID (quote ID, sweep ID)
 *
 * @param id - UUID to validate
 * @param fieldName - Field name for error messages
 * @returns Validated UUID string
 * @throws {ZeroDustError} If UUID format is invalid
 */
export function validateUuid(id: string, fieldName: string): string {
  if (!id || typeof id !== 'string') {
    throw new ZeroDustError(
      'QUOTE_NOT_FOUND',
      `${fieldName} is required`,
      { [fieldName]: id }
    );
  }

  const trimmed = id.trim();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(trimmed)) {
    throw new ZeroDustError(
      'QUOTE_NOT_FOUND',
      `Invalid ${fieldName} format`,
      { [fieldName]: trimmed }
    );
  }

  return trimmed.toLowerCase();
}

/**
 * Validate a positive bigint amount
 *
 * @param amount - Amount to validate (string or bigint)
 * @param fieldName - Field name for error messages
 * @returns Validated bigint
 * @throws {ZeroDustError} If amount is invalid
 */
export function validateAmount(amount: string | bigint, fieldName: string): bigint {
  try {
    const value = typeof amount === 'string' ? BigInt(amount) : amount;

    if (value < 0n) {
      throw new ZeroDustError(
        'BALANCE_TOO_LOW',
        `${fieldName} must be non-negative`,
        { [fieldName]: amount.toString() }
      );
    }

    return value;
  } catch (error) {
    if (error instanceof ZeroDustError) {
      throw error;
    }
    throw new ZeroDustError(
      'INTERNAL_ERROR',
      `Invalid ${fieldName}: not a valid number`,
      { [fieldName]: String(amount) }
    );
  }
}

/**
 * Validate quote request parameters
 *
 * @param params - Quote request parameters
 * @returns Validated parameters
 * @throws {ZeroDustError} If any parameter is invalid
 */
export function validateQuoteRequest(params: {
  fromChainId: unknown;
  toChainId: unknown;
  userAddress: string;
  destination: string;
}): {
  fromChainId: number;
  toChainId: number;
  userAddress: Address;
  destination: Address;
} {
  return {
    fromChainId: validateChainId(params.fromChainId),
    toChainId: validateChainId(params.toChainId),
    userAddress: validateAddress(params.userAddress, 'userAddress'),
    destination: validateAddress(params.destination, 'destination'),
  };
}

/**
 * Validate EIP-7702 authorization object
 *
 * @param auth - Authorization object to validate
 * @returns Validated authorization
 * @throws {ZeroDustError} If authorization is invalid
 */
export function validateEIP7702Authorization(auth: unknown): {
  chainId: number;
  contractAddress: Address;
  nonce: number;
  yParity: 0 | 1;
  r: Hex;
  s: Hex;
} {
  if (!auth || typeof auth !== 'object') {
    throw new ZeroDustError(
      'EIP7702_INVALID_SIGNATURE',
      'EIP-7702 authorization is required',
      { auth }
    );
  }

  const a = auth as Record<string, unknown>;

  // Validate chainId
  const chainId = validateChainId(a['chainId']);

  // Validate contractAddress
  const contractAddress = validateAddress(
    String(a['contractAddress'] ?? ''),
    'eip7702Authorization.contractAddress'
  );

  // Validate nonce
  if (typeof a['nonce'] !== 'number' || !Number.isInteger(a['nonce']) || a['nonce'] < 0) {
    throw new ZeroDustError(
      'EIP7702_INVALID_SIGNATURE',
      'Invalid EIP-7702 nonce',
      { nonce: a['nonce'] }
    );
  }
  const nonce = a['nonce'];

  // Validate yParity
  if (a['yParity'] !== 0 && a['yParity'] !== 1) {
    throw new ZeroDustError(
      'EIP7702_INVALID_SIGNATURE',
      'yParity must be 0 or 1',
      { yParity: a['yParity'] }
    );
  }
  const yParity = a['yParity'] as 0 | 1;

  // Validate r and s (32 bytes each)
  const r = validateHex(String(a['r'] ?? ''), 'r', 32);
  const s = validateHex(String(a['s'] ?? ''), 's', 32);

  return {
    chainId,
    contractAddress,
    nonce,
    yParity,
    r,
    s,
  };
}
