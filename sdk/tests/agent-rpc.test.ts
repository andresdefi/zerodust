/**
 * @fileoverview Tests for which RPC the agent signs against
 *
 * The EIP-7702 authorization nonce is read from the source chain's RPC. The
 * agent used to know public RPCs for only seven chains and fell back to an
 * Ethereum RPC for everything else, so on most chains it signed with the
 * account's Ethereum nonce. The signature was well-formed and the sweep still
 * failed on-chain. These tests pin the RPC per chain, and pin that a nonce the
 * backend disagrees with never reaches submission.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import * as viemChains from 'viem/chains';
import { ZeroDustAgent } from '../src/agent.js';

// Deterministic throwaway key. Never funded, never used anywhere else.
const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const account = privateKeyToAccount(TEST_KEY);

const CONTRACT = '0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2';

// Every chain `GET /chains` serves (2026-09-26).
const API_CHAIN_IDS = [
  1, 10, 56, 100, 130, 137, 146, 196, 252, 480, 1329, 1514, 1868, 5000, 5330, 8453, 9745,
  34443, 42161, 42220, 57073, 60808, 80094, 534352, 7777777,
];

const mockFetch = vi.fn();
global.fetch = mockFetch;

function json(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(data),
  } as Response);
}

function viemRpcFor(chainId: number): string {
  const chain = Object.values(viemChains).find(
    (c) => typeof c === 'object' && c !== null && 'id' in c && c.id === chainId && !c.testnet
  ) as { rpcUrls: { default: { http: readonly string[] } } } | undefined;
  if (!chain) throw new Error(`viem has no chain ${chainId}`);
  return chain.rpcUrls.default.http[0]!;
}

/**
 * Serves the API and answers eth_getTransactionCount with `rpcNonce`,
 * recording which RPC URL was asked.
 */
function installRoutes(opts: { chainId: number; quotedNonce: number; rpcNonce: number }) {
  const rpcUrls: string[] = [];
  mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('api.zerodust.xyz')) {
      if (url.includes('/quote')) {
        return json({
          quoteId: '3f7c1a2e-8b4d-4f6a-9c2e-1d5b7a3e9f04',
          version: 3,
          userBalance: '1000000000000000',
          estimatedReceive: '970000000000000',
          mode: 1,
          fees: {},
          autoRevoke: true,
          intent: {},
          deadline: 4102444800,
          nonce: 0,
          authNonce: opts.quotedNonce,
          validForSeconds: 55,
        });
      }
      if (url.includes('/authorization')) {
        return json({
          sweepType: 'cross-chain',
          contractAddress: CONTRACT,
          version: 3,
          typedData: {
            types: {
              SweepIntent: [{ name: 'destination', type: 'address' }],
            },
            primaryType: 'SweepIntent',
            domain: {
              name: 'ZeroDust',
              version: '3',
              chainId: opts.chainId,
              verifyingContract: account.address,
            },
            message: { destination: account.address },
          },
        });
      }
      if (/\/sweep$/.test(url.split('?')[0] ?? '')) {
        return json({ sweepId: 'should-never-happen', status: 'pending' });
      }
      return json({ error: `unexpected request: ${url}` }, 500);
    }

    // Anything else is a chain RPC.
    rpcUrls.push(normalize(url));
    const body = JSON.parse(String(init?.body)) as { id: number };
    return json({ jsonrpc: '2.0', id: body.id, result: `0x${opts.rpcNonce.toString(16)}` });
  });
  return rpcUrls;
}

function normalize(url: string): string {
  return new URL(url).href;
}

function sweepCalls() {
  return mockFetch.mock.calls.filter(([input, init]) => {
    const url = typeof input === 'string' ? input : String(input);
    return (init as RequestInit | undefined)?.method === 'POST' && /\/sweep$/.test(url.split('?')[0] ?? '');
  });
}

describe('ZeroDustAgent RPC selection', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(API_CHAIN_IDS)('signs chain %i against that chain\'s own RPC', async (chainId) => {
    const rpcUrls = installRoutes({ chainId, quotedNonce: 42, rpcNonce: 42 });
    const agent = new ZeroDustAgent({ account, environment: 'mainnet' });

    const result = await agent.sweep(
      { fromChainId: chainId, toChainId: chainId === 8453 ? 10 : 8453 },
      { dryRun: true }
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(rpcUrls.length).toBeGreaterThan(0);
    expect(new Set(rpcUrls)).toEqual(new Set([normalize(viemRpcFor(chainId))]));
    expect(result.signatures?.delegation.nonce).toBe(42);
    expect(result.signatures?.revoke.nonce).toBe(43);
  });

  it('prefers a caller-supplied RPC over the default', async () => {
    const rpcUrls = installRoutes({ chainId: 146, quotedNonce: 3, rpcNonce: 3 });
    const agent = new ZeroDustAgent({
      account,
      environment: 'mainnet',
      rpcUrls: { 146: 'https://my-sonic-rpc.example' },
    });

    const result = await agent.sweep({ fromChainId: 146, toChainId: 8453 }, { dryRun: true });

    expect(result.success).toBe(true);
    expect(new Set(rpcUrls)).toEqual(new Set([normalize('https://my-sonic-rpc.example')]));
  });

  it('fails closed on a chain with no known RPC instead of guessing', async () => {
    const rpcUrls = installRoutes({ chainId: 999999, quotedNonce: 0, rpcNonce: 0 });
    const agent = new ZeroDustAgent({ account, environment: 'mainnet' });

    const result = await agent.sweep({ fromChainId: 999999, toChainId: 8453 });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No default RPC for chain 999999/);
    expect(rpcUrls).toHaveLength(0);
    expect(sweepCalls()).toHaveLength(0);
  });

  it('refuses to submit when the signed nonce disagrees with the quote', async () => {
    // e.g. an RPC for the wrong chain: the account's nonce there is different
    installRoutes({ chainId: 146, quotedNonce: 99, rpcNonce: 359 });
    const agent = new ZeroDustAgent({ account, environment: 'mainnet' });

    const result = await agent.sweep({ fromChainId: 146, toChainId: 8453 });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nonce 359 does not match the quote's 99 on chain 146/);
    expect(sweepCalls()).toHaveLength(0);
  });
});
