/**
 * @fileoverview Integration tests for chain endpoints
 *
 * These tests run against the real testnet API.
 * Run with: npm run test:integration
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ZeroDust } from '../../src/index.js';

describe('Chains API Integration', () => {
  let client: ZeroDust;

  beforeAll(() => {
    client = new ZeroDust({
      environment: 'testnet',
      timeout: 30000,
    });
  });

  describe('getChains', () => {
    it('should return list of supported chains', async () => {
      const chains = await client.getChains();

      expect(Array.isArray(chains)).toBe(true);
      expect(chains.length).toBeGreaterThan(0);
    });

    it('should return chains with required properties', async () => {
      const chains = await client.getChains();
      const chain = chains[0];

      expect(chain).toHaveProperty('chainId');
      expect(chain).toHaveProperty('name');
      expect(chain).toHaveProperty('contractAddress');
      expect(chain).toHaveProperty('isEnabled');

      expect(typeof chain.chainId).toBe('number');
      expect(typeof chain.name).toBe('string');
      expect(chain.contractAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should include well-known testnet chains', async () => {
      const chains = await client.getChains();
      const chainIds = chains.map((c) => c.chainId);

      // Base Sepolia should be in testnet chains
      expect(chainIds).toContain(84532);
    });

    it('should cache results on subsequent calls', async () => {
      const start1 = Date.now();
      await client.getChains();
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      await client.getChains();
      const time2 = Date.now() - start2;

      // Second call should be much faster (cached)
      expect(time2).toBeLessThan(time1);
      expect(time2).toBeLessThan(10); // Should be nearly instant
    });
  });

  describe('getChain', () => {
    it('should return specific chain by ID', async () => {
      const chain = await client.getChain(84532); // Base Sepolia

      expect(chain.chainId).toBe(84532);
      expect(chain.name).toBeDefined();
    });

    it('should throw for unsupported chain ID', async () => {
      await expect(client.getChain(999999)).rejects.toThrow();
    });
  });
});
