/**
 * @fileoverview Tests for input validation utilities
 */

import { describe, it, expect } from 'vitest';
import {
  validateAddress,
  validateChainId,
  validateSignature,
  validateUuid,
  validateAmount,
  validateQuoteRequest,
  validateEIP7702Authorization,
  validateHex,
} from '../src/utils/validation.js';
import { InvalidAddressError, ZeroDustError } from '../src/errors.js';

describe('validateAddress', () => {
  it('should accept valid checksummed address', () => {
    const address = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
    const result = validateAddress(address);
    expect(result).toBe(address);
  });

  it('should accept and checksum lowercase address', () => {
    const address = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';
    const result = validateAddress(address);
    expect(result).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
  });

  it('should accept and checksum uppercase address', () => {
    const address = '0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED';
    const result = validateAddress(address);
    expect(result).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
  });

  it('should trim whitespace', () => {
    const address = '  0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed  ';
    const result = validateAddress(address);
    expect(result).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
  });

  it('should throw for invalid address format', () => {
    expect(() => validateAddress('not-an-address')).toThrow(InvalidAddressError);
    expect(() => validateAddress('0x123')).toThrow(InvalidAddressError);
    expect(() => validateAddress('0xGGGG')).toThrow(InvalidAddressError);
  });

  it('should throw for empty string', () => {
    expect(() => validateAddress('')).toThrow(InvalidAddressError);
  });

  it('should throw for null/undefined', () => {
    expect(() => validateAddress(null as unknown as string)).toThrow(InvalidAddressError);
    expect(() => validateAddress(undefined as unknown as string)).toThrow(InvalidAddressError);
  });

  it('should include field name in error', () => {
    try {
      validateAddress('invalid', 'userAddress');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidAddressError);
      expect((error as InvalidAddressError).message).toContain('userAddress');
    }
  });
});

describe('validateChainId', () => {
  it('should accept valid chain IDs', () => {
    expect(validateChainId(1)).toBe(1); // Ethereum
    expect(validateChainId(8453)).toBe(8453); // Base
    expect(validateChainId(42161)).toBe(42161); // Arbitrum
  });

  it('should reject non-integers', () => {
    expect(() => validateChainId(1.5)).toThrow(ZeroDustError);
    expect(() => validateChainId('1')).toThrow(ZeroDustError);
  });

  it('should reject zero and negative', () => {
    expect(() => validateChainId(0)).toThrow(ZeroDustError);
    expect(() => validateChainId(-1)).toThrow(ZeroDustError);
  });

  it('should reject non-numbers', () => {
    expect(() => validateChainId(null)).toThrow(ZeroDustError);
    expect(() => validateChainId(undefined)).toThrow(ZeroDustError);
    expect(() => validateChainId({})).toThrow(ZeroDustError);
  });
});

describe('validateSignature', () => {
  const validSig65 = '0x' + 'a'.repeat(130); // 65 bytes
  const validSig64 = '0x' + 'b'.repeat(128); // 64 bytes

  it('should accept 65-byte signature', () => {
    const result = validateSignature(validSig65);
    expect(result).toBe(validSig65);
  });

  it('should accept 64-byte signature', () => {
    const result = validateSignature(validSig64);
    expect(result).toBe(validSig64);
  });

  it('should reject wrong length', () => {
    expect(() => validateSignature('0x' + 'a'.repeat(100))).toThrow(ZeroDustError);
    expect(() => validateSignature('0x' + 'a'.repeat(132))).toThrow(ZeroDustError);
  });

  it('should reject invalid hex', () => {
    expect(() => validateSignature('not-hex')).toThrow(ZeroDustError);
    expect(() => validateSignature('0xGGGG')).toThrow(ZeroDustError);
  });

  it('should reject empty', () => {
    expect(() => validateSignature('')).toThrow(ZeroDustError);
    expect(() => validateSignature(null as unknown as string)).toThrow(ZeroDustError);
  });
});

describe('validateUuid', () => {
  const validUuid = '550e8400-e29b-41d4-a716-446655440000';

  it('should accept valid UUID', () => {
    const result = validateUuid(validUuid, 'quoteId');
    expect(result).toBe(validUuid);
  });

  it('should normalize to lowercase', () => {
    const upperUuid = '550E8400-E29B-41D4-A716-446655440000';
    const result = validateUuid(upperUuid, 'quoteId');
    expect(result).toBe(validUuid);
  });

  it('should trim whitespace', () => {
    const result = validateUuid(`  ${validUuid}  `, 'quoteId');
    expect(result).toBe(validUuid);
  });

  it('should reject invalid format', () => {
    expect(() => validateUuid('not-a-uuid', 'quoteId')).toThrow(ZeroDustError);
    expect(() => validateUuid('12345', 'quoteId')).toThrow(ZeroDustError);
  });

  it('should reject empty', () => {
    expect(() => validateUuid('', 'quoteId')).toThrow(ZeroDustError);
  });
});

describe('validateAmount', () => {
  it('should accept valid bigint', () => {
    expect(validateAmount(1000n, 'amount')).toBe(1000n);
    expect(validateAmount(0n, 'amount')).toBe(0n);
  });

  it('should accept valid string', () => {
    expect(validateAmount('1000', 'amount')).toBe(1000n);
    expect(validateAmount('0', 'amount')).toBe(0n);
  });

  it('should reject negative', () => {
    expect(() => validateAmount(-1n, 'amount')).toThrow(ZeroDustError);
    expect(() => validateAmount('-1', 'amount')).toThrow(ZeroDustError);
  });

  it('should reject invalid strings', () => {
    expect(() => validateAmount('not-a-number', 'amount')).toThrow(ZeroDustError);
    expect(() => validateAmount('1.5', 'amount')).toThrow(ZeroDustError);
  });
});

describe('validateHex', () => {
  it('should accept valid hex', () => {
    const result = validateHex('0xabcd', 'data');
    expect(result).toBe('0xabcd');
  });

  it('should validate expected bytes', () => {
    const hex32 = '0x' + 'ab'.repeat(32);
    expect(validateHex(hex32, 'hash', 32)).toBe(hex32);
  });

  it('should reject wrong byte length', () => {
    const hex16 = '0x' + 'ab'.repeat(16);
    expect(() => validateHex(hex16, 'hash', 32)).toThrow(ZeroDustError);
  });

  it('should reject non-hex', () => {
    expect(() => validateHex('not-hex', 'data')).toThrow(ZeroDustError);
  });
});

describe('validateQuoteRequest', () => {
  const validRequest = {
    fromChainId: 8453,
    toChainId: 8453,
    userAddress: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    destination: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  };

  it('should validate all fields', () => {
    const result = validateQuoteRequest(validRequest);
    expect(result.fromChainId).toBe(8453);
    expect(result.toChainId).toBe(8453);
    expect(result.userAddress).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
    expect(result.destination).toBe('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D');
  });

  it('should throw for invalid chain', () => {
    expect(() => validateQuoteRequest({ ...validRequest, fromChainId: -1 })).toThrow();
  });

  it('should throw for invalid address', () => {
    expect(() => validateQuoteRequest({ ...validRequest, userAddress: 'invalid' })).toThrow();
  });
});

describe('validateEIP7702Authorization', () => {
  const validAuth = {
    chainId: 8453,
    contractAddress: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    nonce: 0,
    yParity: 0 as const,
    r: '0x' + 'ab'.repeat(32),
    s: '0x' + 'cd'.repeat(32),
  };

  it('should validate all fields', () => {
    const result = validateEIP7702Authorization(validAuth);
    expect(result.chainId).toBe(8453);
    expect(result.nonce).toBe(0);
    expect(result.yParity).toBe(0);
  });

  it('should accept yParity of 1', () => {
    const result = validateEIP7702Authorization({ ...validAuth, yParity: 1 });
    expect(result.yParity).toBe(1);
  });

  it('should reject invalid yParity', () => {
    expect(() => validateEIP7702Authorization({ ...validAuth, yParity: 2 })).toThrow();
  });

  it('should reject invalid r/s length', () => {
    expect(() => validateEIP7702Authorization({ ...validAuth, r: '0xaabb' })).toThrow();
  });

  it('should reject negative nonce', () => {
    expect(() => validateEIP7702Authorization({ ...validAuth, nonce: -1 })).toThrow();
  });

  it('should reject null/undefined', () => {
    expect(() => validateEIP7702Authorization(null)).toThrow();
    expect(() => validateEIP7702Authorization(undefined)).toThrow();
  });
});
