/**
 * @fileoverview Tests for ZeroDust client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZeroDust } from '../src/client.js';
import {
  ZeroDustError,
  TimeoutError,
} from '../src/errors.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockJsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({
      'content-type': 'application/json',
    }),
    json: () => Promise.resolve(data),
  } as Response);
}

describe('ZeroDust Client', () => {
  let client: ZeroDust;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new ZeroDust({ environment: 'mainnet' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use testnet URL by default', () => {
      const c = new ZeroDust();
      expect(c).toBeDefined();
    });

    it('should accept custom baseUrl', () => {
      const c = new ZeroDust({ baseUrl: 'https://custom.api.com' });
      expect(c).toBeDefined();
    });

    it('should accept mainnet environment', () => {
      const c = new ZeroDust({ environment: 'mainnet' });
      expect(c).toBeDefined();
    });
  });

  describe('getChains', () => {
    it('should fetch and return chains array', async () => {
      const mockChains = {
        chains: [
          {
            chainId: 8453,
            name: 'Base',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            contractAddress: '0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2',
            isEnabled: true,
            minSweepWei: '100000000000000',
            explorer: 'https://basescan.org',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce(mockJsonResponse(mockChains));

      const result = await client.getChains();

      expect(result).toHaveLength(1);
      expect(result[0].chainId).toBe(8453);
      expect(result[0].name).toBe('Base');
    });

    it('should cache chains for subsequent calls', async () => {
      const mockChains = { chains: [{ chainId: 1, name: 'Ethereum' }] };
      mockFetch.mockResolvedValue(mockJsonResponse(mockChains));

      await client.getChains();
      await client.getChains();

      // Should only call fetch once due to caching
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getChain', () => {
    it('should fetch specific chain by ID', async () => {
      const mockChain = { chainId: 8453, name: 'Base' };
      mockFetch.mockResolvedValueOnce(mockJsonResponse(mockChain));

      const chain = await client.getChain(8453);

      expect(chain.name).toBe('Base');
      expect(chain.chainId).toBe(8453);
    });

    it('should throw for invalid chain ID', async () => {
      await expect(client.getChain(-1)).rejects.toThrow(ZeroDustError);
    });
  });

  describe('getBalances', () => {
    const userAddress = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

    it('should fetch balances for address', async () => {
      const mockBalances = {
        balances: [
          {
            chainId: 8453,
            chainName: 'Base',
            balance: '1000000000000000000',
            balanceFormatted: '1.0 ETH',
            isSweepable: true,
          },
        ],
        totalUsd: '2500.00',
      };

      mockFetch.mockResolvedValueOnce(mockJsonResponse(mockBalances));

      const result = await client.getBalances(userAddress);

      expect(result.balances).toHaveLength(1);
      expect(result.balances[0].chainId).toBe(8453);
      expect(result.totalUsd).toBe('2500.00');
    });

    it('should validate address', async () => {
      await expect(client.getBalances('invalid-address')).rejects.toThrow();
    });
  });

  describe('getBalance', () => {
    const userAddress = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

    it('should fetch balance for specific chain', async () => {
      const mockBalance = {
        chainId: 8453,
        chainName: 'Base',
        balance: '500000000000000000',
        balanceFormatted: '0.5 ETH',
        isSweepable: true,
      };

      mockFetch.mockResolvedValueOnce(mockJsonResponse(mockBalance));

      const result = await client.getBalance(userAddress, 8453);

      expect(result.chainId).toBe(8453);
      expect(result.balance).toBe('500000000000000000');
    });
  });

  describe('getQuote', () => {
    const quoteRequest = {
      fromChainId: 8453,
      toChainId: 8453,
      userAddress: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      destination: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    };

    it('should fetch quote', async () => {
      const mockQuote = {
        quoteId: '550e8400-e29b-41d4-a716-446655440000',
        fromChainId: 8453,
        toChainId: 8453,
        userAddress: quoteRequest.userAddress,
        destination: quoteRequest.destination,
        balanceWei: '1000000000000000000',
        minReceiveWei: '900000000000000000',
        fees: {
          serviceFeeWei: '10000000000000000',
          gasReimbursementWei: '5000000000000000',
          bridgeFeeWei: '0',
          totalFeeWei: '15000000000000000',
        },
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };

      mockFetch.mockResolvedValueOnce(mockJsonResponse(mockQuote));

      const result = await client.getQuote(quoteRequest);

      expect(result.quoteId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(result.fromChainId).toBe(8453);
    });

    it('should validate request parameters', async () => {
      await expect(
        client.getQuote({
          ...quoteRequest,
          userAddress: 'invalid',
        })
      ).rejects.toThrow();
    });
  });

  describe('createAuthorization', () => {
    it('should create authorization for quote', async () => {
      const mockAuth = {
        quoteId: '550e8400-e29b-41d4-a716-446655440000',
        typedData: {
          types: {
            EIP712Domain: [],
            SweepIntent: [],
          },
          primaryType: 'SweepIntent',
          domain: {
            name: 'ZeroDustSweep',
            version: '1',
            chainId: 8453,
            verifyingContract: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
          },
          message: {},
        },
        eip7702: {
          chainId: 8453,
          contractAddress: '0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2',
          nonce: 0,
        },
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };

      mockFetch.mockResolvedValueOnce(mockJsonResponse(mockAuth));

      const result = await client.createAuthorization(
        '550e8400-e29b-41d4-a716-446655440000'
      );

      expect(result.quoteId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(result.typedData.primaryType).toBe('SweepIntent');
    });

    it('should validate quote ID format', async () => {
      await expect(client.createAuthorization('invalid-id')).rejects.toThrow();
    });
  });

  describe('submitSweep', () => {
    const sweepRequest = {
      quoteId: '550e8400-e29b-41d4-a716-446655440000',
      signature: '0x' + 'a'.repeat(130),
      eip7702Authorization: {
        chainId: 8453,
        contractAddress: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
        nonce: 0,
        yParity: 0 as const,
        r: '0x' + 'ab'.repeat(32),
        s: '0x' + 'cd'.repeat(32),
      },
    };

    it('should submit sweep', async () => {
      const mockSweep = {
        sweepId: '660f8400-e29b-41d4-a716-446655440000',
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      mockFetch.mockResolvedValueOnce(mockJsonResponse(mockSweep));

      const result = await client.submitSweep(sweepRequest);

      expect(result.sweepId).toBe('660f8400-e29b-41d4-a716-446655440000');
      expect(result.status).toBe('pending');
    });

    it('should validate signature format', async () => {
      await expect(
        client.submitSweep({
          ...sweepRequest,
          signature: 'invalid-sig',
        })
      ).rejects.toThrow();
    });
  });

  describe('getSweepStatus', () => {
    it('should get sweep status', async () => {
      const mockStatus = {
        sweepId: '660f8400-e29b-41d4-a716-446655440000',
        status: 'completed',
        txHash: '0x' + 'ab'.repeat(32),
        fromChainId: 8453,
        toChainId: 8453,
        amountSwept: '1000000000000000000',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };

      mockFetch.mockResolvedValueOnce(mockJsonResponse(mockStatus));

      const result = await client.getSweepStatus(
        '660f8400-e29b-41d4-a716-446655440000'
      );

      expect(result.status).toBe('completed');
      expect(result.txHash).toBeDefined();
    });
  });

  describe('getSweeps', () => {
    const userAddress = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

    it('should list sweeps for user', async () => {
      const mockSweeps = {
        sweeps: [
          {
            sweepId: '660f8400-e29b-41d4-a716-446655440000',
            status: 'completed',
            fromChainId: 8453,
            toChainId: 8453,
            createdAt: new Date().toISOString(),
          },
        ],
        total: 1,
      };

      mockFetch.mockResolvedValueOnce(mockJsonResponse(mockSweeps));

      const result = await client.getSweeps(userAddress);

      expect(result.sweeps).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should accept pagination options', async () => {
      const mockSweeps = { sweeps: [], total: 0 };
      mockFetch.mockResolvedValueOnce(mockJsonResponse(mockSweeps));

      await client.getSweeps(userAddress, { limit: 10, offset: 20 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.any(Object)
      );
    });
  });

  describe('waitForSweep', () => {
    it('should poll until completed', async () => {
      const sweepId = '660f8400-e29b-41d4-a716-446655440000';

      // First call: pending
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          sweepId,
          status: 'pending',
        })
      );

      // Second call: executing
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          sweepId,
          status: 'executing',
        })
      );

      // Third call: completed
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          sweepId,
          status: 'completed',
          txHash: '0x' + 'ab'.repeat(32),
        })
      );

      const result = await client.waitForSweep(sweepId, {
        intervalMs: 10,
        timeoutMs: 5000,
      });

      expect(result.status).toBe('completed');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should return failed status without throwing', async () => {
      const sweepId = '660f8400-e29b-41d4-a716-446655440000';

      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          sweepId,
          status: 'failed',
          error: 'Execution failed',
        })
      );

      // waitForSweep returns the final status, including failed ones
      const result = await client.waitForSweep(sweepId, {
        intervalMs: 10,
        timeoutMs: 5000,
      });

      expect(result.status).toBe('failed');
    });

    it('should timeout after specified duration', async () => {
      const sweepId = '660f8400-e29b-41d4-a716-446655440000';

      // Always return pending
      mockFetch.mockResolvedValue(
        mockJsonResponse({
          sweepId,
          status: 'pending',
        })
      );

      await expect(
        client.waitForSweep(sweepId, { intervalMs: 10, timeoutMs: 50 })
      ).rejects.toThrow(TimeoutError);
    });
  });

  describe('Error Handling', () => {
    it('should throw ZeroDustError for API errors', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse(
          {
            error: 'Balance too low',
            code: 'BALANCE_TOO_LOW',
          },
          400
        )
      );

      await expect(client.getChains()).rejects.toThrow(ZeroDustError);
    });

    it('should throw for expired quotes', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse(
          {
            error: 'Quote has expired',
            code: 'QUOTE_EXPIRED',
          },
          400
        )
      );

      await expect(
        client.createAuthorization('550e8400-e29b-41d4-a716-446655440000')
      ).rejects.toThrow(ZeroDustError);
    });

    it('should wrap network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

      await expect(client.getChains()).rejects.toThrow();
    });

    it('should include status code in errors', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse(
          {
            error: 'Internal server error',
            code: 'INTERNAL_ERROR',
          },
          500
        )
      );

      try {
        await client.getChains();
      } catch (error) {
        expect(error).toBeInstanceOf(ZeroDustError);
        expect((error as ZeroDustError).statusCode).toBe(500);
      }
    });
  });
});

describe('ZeroDust with custom config', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should use custom timeout', async () => {
    const client = new ZeroDust({
      environment: 'mainnet',
      timeout: 5000,
    });

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ chains: [] })
    );

    const result = await client.getChains();
    expect(result).toEqual([]);
  });

  it('should call fetch with correct URL', async () => {
    const client = new ZeroDust({
      environment: 'mainnet',
    });

    mockFetch.mockResolvedValueOnce(mockJsonResponse({ chains: [] }));

    await client.getChains();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.zerodust.xyz'),
      expect.any(Object)
    );
  });
});
