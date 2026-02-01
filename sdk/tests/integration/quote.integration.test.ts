/**
 * @fileoverview Integration tests for quote endpoints
 *
 * These tests run against the real testnet API.
 * Run with: npm run test:integration
 *
 * Note: Quote tests may fail if the test addresses don't have
 * sufficient balance on the testnet chains.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ZeroDust, ZeroDustError, InvalidAddressError } from '../../src/index.js';

describe('Quote API Integration', () => {
  let client: ZeroDust;

  // Test addresses - using well-known addresses
  const USER_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const DESTINATION = '0x000000000000000000000000000000000000dEaD';

  // Testnet chain IDs
  const BASE_SEPOLIA = 84532;
  const ARBITRUM_SEPOLIA = 421614;

  beforeAll(() => {
    client = new ZeroDust({
      environment: 'testnet',
      timeout: 30000,
    });
  });

  describe('getQuote - validation', () => {
    it('should throw for invalid user address', async () => {
      await expect(
        client.getQuote({
          fromChainId: BASE_SEPOLIA,
          toChainId: BASE_SEPOLIA,
          userAddress: 'invalid',
          destination: DESTINATION,
        })
      ).rejects.toThrow(InvalidAddressError);
    });

    it('should throw for invalid destination address', async () => {
      await expect(
        client.getQuote({
          fromChainId: BASE_SEPOLIA,
          toChainId: BASE_SEPOLIA,
          userAddress: USER_ADDRESS,
          destination: 'not-an-address',
        })
      ).rejects.toThrow(InvalidAddressError);
    });

    it('should throw for invalid chain ID', async () => {
      await expect(
        client.getQuote({
          fromChainId: -1,
          toChainId: BASE_SEPOLIA,
          userAddress: USER_ADDRESS,
          destination: DESTINATION,
        })
      ).rejects.toThrow(ZeroDustError);
    });

    it('should throw for unsupported chain', async () => {
      await expect(
        client.getQuote({
          fromChainId: 999999,
          toChainId: BASE_SEPOLIA,
          userAddress: USER_ADDRESS,
          destination: DESTINATION,
        })
      ).rejects.toThrow();
    });
  });

  describe('getQuote - same chain', () => {
    it('should return quote for same-chain sweep', async () => {
      try {
        const quote = await client.getQuote({
          fromChainId: BASE_SEPOLIA,
          toChainId: BASE_SEPOLIA,
          userAddress: USER_ADDRESS,
          destination: DESTINATION,
        });

        // Verify quote structure
        expect(quote).toHaveProperty('quoteId');
        expect(quote).toHaveProperty('fromChainId', BASE_SEPOLIA);
        expect(quote).toHaveProperty('toChainId', BASE_SEPOLIA);
        expect(quote).toHaveProperty('balanceWei');
        expect(quote).toHaveProperty('minReceiveWei');
        expect(quote).toHaveProperty('fees');
        expect(quote).toHaveProperty('expiresAt');

        // Verify fee structure
        expect(quote.fees).toHaveProperty('serviceFeeWei');
        expect(quote.fees).toHaveProperty('gasReimbursementWei');
        expect(quote.fees).toHaveProperty('totalFeeWei');

        // Quote ID should be a UUID
        expect(quote.quoteId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
      } catch (error) {
        // If balance is too low, that's expected for some test addresses
        if (error instanceof ZeroDustError && error.code === 'BALANCE_TOO_LOW') {
          console.log('Skipping: Test address has insufficient balance');
          return;
        }
        throw error;
      }
    });

    it('should have expiration in the future', async () => {
      try {
        const quote = await client.getQuote({
          fromChainId: BASE_SEPOLIA,
          toChainId: BASE_SEPOLIA,
          userAddress: USER_ADDRESS,
          destination: DESTINATION,
        });

        const expiresAt = new Date(quote.expiresAt).getTime();
        const now = Date.now();

        expect(expiresAt).toBeGreaterThan(now);
        // Quote should expire within ~60 seconds
        expect(expiresAt - now).toBeLessThan(120000);
      } catch (error) {
        if (error instanceof ZeroDustError && error.code === 'BALANCE_TOO_LOW') {
          console.log('Skipping: Test address has insufficient balance');
          return;
        }
        throw error;
      }
    });
  });

  describe('getQuote - cross chain', () => {
    it('should return quote for cross-chain sweep', async () => {
      try {
        const quote = await client.getQuote({
          fromChainId: ARBITRUM_SEPOLIA,
          toChainId: BASE_SEPOLIA,
          userAddress: USER_ADDRESS,
          destination: DESTINATION,
        });

        expect(quote.fromChainId).toBe(ARBITRUM_SEPOLIA);
        expect(quote.toChainId).toBe(BASE_SEPOLIA);

        // Cross-chain should include bridge fee
        expect(quote.fees).toHaveProperty('bridgeFeeWei');
      } catch (error) {
        if (error instanceof ZeroDustError) {
          // Expected errors for cross-chain
          const expectedCodes = ['BALANCE_TOO_LOW', 'BRIDGE_UNAVAILABLE'];
          if (expectedCodes.includes(error.code)) {
            console.log(`Skipping: ${error.code}`);
            return;
          }
        }
        throw error;
      }
    });
  });

  describe('createAuthorization', () => {
    it('should throw for invalid quote ID format', async () => {
      await expect(client.createAuthorization('invalid-id')).rejects.toThrow(
        ZeroDustError
      );
    });

    it('should throw for non-existent quote ID', async () => {
      const fakeQuoteId = '00000000-0000-0000-0000-000000000000';
      await expect(client.createAuthorization(fakeQuoteId)).rejects.toThrow();
    });
  });
});
