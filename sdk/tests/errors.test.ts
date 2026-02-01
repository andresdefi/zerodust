/**
 * @fileoverview Tests for error handling
 */

import { describe, it, expect } from 'vitest';
import {
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
} from '../src/errors.js';

describe('ZeroDustError', () => {
  it('should create error with code and message', () => {
    const error = new ZeroDustError('BALANCE_TOO_LOW', 'Balance is too low');

    expect(error.code).toBe('BALANCE_TOO_LOW');
    expect(error.message).toBe('Balance is too low');
    expect(error.name).toBe('ZeroDustError');
  });

  it('should include details', () => {
    const error = new ZeroDustError('BALANCE_TOO_LOW', 'Balance is too low', {
      minBalance: '1000000',
      currentBalance: '500000',
    });

    expect(error.details).toEqual({
      minBalance: '1000000',
      currentBalance: '500000',
    });
  });

  it('should include status code', () => {
    const error = new ZeroDustError('BALANCE_TOO_LOW', 'Balance is too low', {}, 400);

    expect(error.statusCode).toBe(400);
  });

  it('should have proper stack trace', () => {
    const error = new ZeroDustError('INTERNAL_ERROR', 'Something went wrong');

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('ZeroDustError');
  });
});

describe('ZeroDustError.getUserMessage', () => {
  it('should return user-friendly message for known codes', () => {
    const error = new ZeroDustError('BALANCE_TOO_LOW', 'Technical message');

    expect(error.getUserMessage()).toBe('Your balance is too low to sweep.');
  });

  it('should return original message for unknown codes', () => {
    const error = new ZeroDustError(
      'UNKNOWN_CODE' as never,
      'Some technical message'
    );

    expect(error.getUserMessage()).toBe('Some technical message');
  });
});

describe('ZeroDustError.isRetryable', () => {
  it('should return true for retryable errors', () => {
    expect(new ZeroDustError('NETWORK_ERROR', 'error').isRetryable()).toBe(true);
    expect(new ZeroDustError('TIMEOUT', 'error').isRetryable()).toBe(true);
    expect(new ZeroDustError('RPC_ERROR', 'error').isRetryable()).toBe(true);
    expect(new ZeroDustError('SERVICE_UNAVAILABLE', 'error').isRetryable()).toBe(true);
  });

  it('should return false for non-retryable errors', () => {
    expect(new ZeroDustError('BALANCE_TOO_LOW', 'error').isRetryable()).toBe(false);
    expect(new ZeroDustError('QUOTE_EXPIRED', 'error').isRetryable()).toBe(false);
    expect(new ZeroDustError('INVALID_SIGNATURE', 'error').isRetryable()).toBe(false);
  });
});

describe('ZeroDustError.toJSON', () => {
  it('should convert to plain object', () => {
    const error = new ZeroDustError('BALANCE_TOO_LOW', 'Balance is too low', {
      minBalance: '1000000',
    }, 400);

    const json = error.toJSON();

    expect(json).toEqual({
      name: 'ZeroDustError',
      code: 'BALANCE_TOO_LOW',
      message: 'Balance is too low',
      userMessage: 'Your balance is too low to sweep.',
      details: { minBalance: '1000000' },
      statusCode: 400,
      retryable: false,
    });
  });
});

describe('Specific Error Classes', () => {
  describe('BalanceTooLowError', () => {
    it('should set correct code and message', () => {
      const error = new BalanceTooLowError('0.01 ETH', '0.005 ETH');

      expect(error.code).toBe('BALANCE_TOO_LOW');
      expect(error.message).toContain('0.01 ETH');
      expect(error.details?.['minBalance']).toBe('0.01 ETH');
      expect(error.details?.['currentBalance']).toBe('0.005 ETH');
    });
  });

  describe('QuoteExpiredError', () => {
    it('should set correct code and message', () => {
      const error = new QuoteExpiredError('quote-123');

      expect(error.code).toBe('QUOTE_EXPIRED');
      expect(error.details?.['quoteId']).toBe('quote-123');
    });
  });

  describe('NetworkError', () => {
    it('should set correct code', () => {
      const error = new NetworkError('Connection failed');

      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.isRetryable()).toBe(true);
    });
  });

  describe('TimeoutError', () => {
    it('should set correct code and timeout', () => {
      const error = new TimeoutError(30000);

      expect(error.code).toBe('TIMEOUT');
      expect(error.message).toContain('30000ms');
      expect(error.details?.['timeoutMs']).toBe(30000);
    });
  });

  describe('ChainNotSupportedError', () => {
    it('should include chain ID', () => {
      const error = new ChainNotSupportedError(12345);

      expect(error.code).toBe('CHAIN_NOT_SUPPORTED');
      expect(error.message).toContain('12345');
      expect(error.details?.['chainId']).toBe(12345);
    });
  });

  describe('InvalidAddressError', () => {
    it('should include address and field name', () => {
      const error = new InvalidAddressError('bad-address', 'userAddress');

      expect(error.code).toBe('INVALID_ADDRESS');
      expect(error.message).toContain('bad-address');
      expect(error.message).toContain('userAddress');
    });
  });

  describe('SignatureError', () => {
    it('should accept signature error codes', () => {
      const error1 = new SignatureError('INVALID_SIGNATURE', 'Bad sig');
      const error2 = new SignatureError('EIP7702_INVALID_SIGNATURE', 'Bad auth');
      const error3 = new SignatureError('SIGNATURE_REJECTED', 'User cancelled');

      expect(error1.code).toBe('INVALID_SIGNATURE');
      expect(error2.code).toBe('EIP7702_INVALID_SIGNATURE');
      expect(error3.code).toBe('SIGNATURE_REJECTED');
    });
  });

  describe('BridgeError', () => {
    it('should accept bridge error codes', () => {
      const error1 = new BridgeError('BRIDGE_UNAVAILABLE', 'No route');
      const error2 = new BridgeError('SOURCE_CHAIN_DISABLED', 'Chain disabled');
      const error3 = new BridgeError('DEST_CHAIN_DISABLED', 'Dest disabled');

      expect(error1.code).toBe('BRIDGE_UNAVAILABLE');
      expect(error2.code).toBe('SOURCE_CHAIN_DISABLED');
      expect(error3.code).toBe('DEST_CHAIN_DISABLED');
    });
  });
});

describe('createErrorFromResponse', () => {
  it('should create error from API response', () => {
    const error = createErrorFromResponse(400, {
      error: 'Balance too low',
      code: 'BALANCE_TOO_LOW',
    });

    expect(error.code).toBe('BALANCE_TOO_LOW');
    expect(error.message).toBe('Balance too low');
    expect(error.statusCode).toBe(400);
  });

  it('should default to INTERNAL_ERROR for missing code', () => {
    const error = createErrorFromResponse(500, {
      error: 'Something went wrong',
    });

    expect(error.code).toBe('INTERNAL_ERROR');
  });
});

describe('isZeroDustError', () => {
  it('should return true for ZeroDustError', () => {
    const error = new ZeroDustError('INTERNAL_ERROR', 'error');
    expect(isZeroDustError(error)).toBe(true);
  });

  it('should return true for subclasses', () => {
    expect(isZeroDustError(new BalanceTooLowError('0.01'))).toBe(true);
    expect(isZeroDustError(new NetworkError('error'))).toBe(true);
  });

  it('should return false for other errors', () => {
    expect(isZeroDustError(new Error('error'))).toBe(false);
    expect(isZeroDustError(null)).toBe(false);
    expect(isZeroDustError('error')).toBe(false);
  });
});

describe('wrapError', () => {
  it('should return ZeroDustError unchanged', () => {
    const original = new ZeroDustError('BALANCE_TOO_LOW', 'error');
    const wrapped = wrapError(original);

    expect(wrapped).toBe(original);
  });

  it('should wrap generic Error', () => {
    const original = new Error('Something went wrong');
    const wrapped = wrapError(original);

    expect(isZeroDustError(wrapped)).toBe(true);
    expect(wrapped.message).toContain('Something went wrong');
  });

  it('should detect timeout errors', () => {
    const original = new Error('Request timed out');
    original.name = 'AbortError';
    const wrapped = wrapError(original);

    expect(wrapped.code).toBe('TIMEOUT');
  });

  it('should detect network errors', () => {
    const original = new Error('fetch failed: network error');
    const wrapped = wrapError(original);

    expect(wrapped.code).toBe('NETWORK_ERROR');
  });

  it('should add context to message', () => {
    const original = new Error('Connection reset');
    const wrapped = wrapError(original, 'GET /quote');

    expect(wrapped.message).toContain('GET /quote');
    expect(wrapped.message).toContain('Connection reset');
  });

  it('should wrap non-Error values', () => {
    const wrapped1 = wrapError('string error');
    const wrapped2 = wrapError(42);
    const wrapped3 = wrapError(null);

    expect(isZeroDustError(wrapped1)).toBe(true);
    expect(isZeroDustError(wrapped2)).toBe(true);
    expect(isZeroDustError(wrapped3)).toBe(true);
  });
});
