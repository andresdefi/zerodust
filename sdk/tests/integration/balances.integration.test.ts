/**
 * @fileoverview Integration tests for balance endpoints
 *
 * These tests run against the real testnet API.
 * Run with: npm run test:integration
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ZeroDust, InvalidAddressError } from '../../src/index.js';

describe('Balances API Integration', () => {
  let client: ZeroDust;

  // Well-known addresses for testing (vitalik.eth)
  const TEST_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  // Zero address (will have 0 balance)
  const ZERO_BALANCE_ADDRESS = '0x0000000000000000000000000000000000000001';

  beforeAll(() => {
    client = new ZeroDust({
      environment: 'testnet',
      timeout: 30000,
    });
  });

  describe('getBalances', () => {
    it('should return balances for valid address', async () => {
      const result = await client.getBalances(TEST_ADDRESS);

      expect(result).toHaveProperty('balances');
      expect(Array.isArray(result.balances)).toBe(true);
    });

    it('should return balances with required properties', async () => {
      const result = await client.getBalances(TEST_ADDRESS);

      if (result.balances.length > 0) {
        const balance = result.balances[0];
        expect(balance).toHaveProperty('chainId');
        expect(balance).toHaveProperty('balance');
        expect(balance).toHaveProperty('isSweepable');
      }
    });

    it('should normalize lowercase addresses', async () => {
      const lowercaseAddress = TEST_ADDRESS.toLowerCase();
      const result = await client.getBalances(lowercaseAddress);

      expect(result).toHaveProperty('balances');
    });

    it('should throw for invalid address', async () => {
      await expect(client.getBalances('invalid-address')).rejects.toThrow(
        InvalidAddressError
      );
    });

    it('should throw for empty address', async () => {
      await expect(client.getBalances('')).rejects.toThrow(InvalidAddressError);
    });
  });

  describe('getBalance', () => {
    it('should return balance for specific chain', async () => {
      const balance = await client.getBalance(TEST_ADDRESS, 84532); // Base Sepolia

      expect(balance).toHaveProperty('chainId');
      expect(balance.chainId).toBe(84532);
      expect(balance).toHaveProperty('balance');
      expect(typeof balance.balance).toBe('string');
    });

    it('should return zero for address with no balance', async () => {
      const balance = await client.getBalance(ZERO_BALANCE_ADDRESS, 84532);

      expect(balance.balance).toBe('0');
      expect(balance.isSweepable).toBe(false);
    });

    it('should throw for invalid chain ID', async () => {
      await expect(client.getBalance(TEST_ADDRESS, -1)).rejects.toThrow();
    });

    it('should throw for unsupported chain', async () => {
      await expect(client.getBalance(TEST_ADDRESS, 999999)).rejects.toThrow();
    });
  });
});
