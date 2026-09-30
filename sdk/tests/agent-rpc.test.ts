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
import * as viemChains from 'viem/chains';
import { ZeroDustAgent } from '../src/agent.js';
import { account, makeQuote, makeAuthorization, json, rpcResponse, isSweepPost } from './helpers/sweep-api.js';

// Every chain `GET /chains` serves (2026-09-26).
const API_CHAIN_IDS = [
  1, 10, 56, 100, 130, 137, 146, 196, 252, 480, 1329, 1514, 1868, 5000, 5330, 8453, 9745,
  34443, 42161, 42220, 57073, 60808, 80094, 534352, 7777777,
];

const mockFetch = vi.fn();
global.fetch = mockFetch;

function viemRpcFor(chainId: number): string {
  const chain = Object.values(viemChains).find(
    (c) => typeof c === 'object' && c !== null && 'id' in c && c.id === chainId && !c.testnet
  ) as { rpcUrls: { default: { http: readonly string[] } } } | undefined;
  if (!chain) throw new Error(`viem has no chain ${chainId}`);
  return chain.rpcUrls.default.http[0]!;
}

/**
 * Serves the API (a same-chain quote on `chainId`) and answers the chain RPC
 * with `rpcNonce` as the account nonce, recording which RPC URL was asked.
 */
function installRoutes(opts: { chainId: number; quotedNonce: number; rpcNonce: number }) {
  const rpcUrls: string[] = [];
  const quote = { ...makeQuote({ fromChainId: opts.chainId }), authNonce: opts.quotedNonce };
  mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('api.zerodust.xyz')) {
      if (url.includes('/quote')) return json(quote);
      if (url.includes('/authorization')) return json(makeAuthorization(quote, opts.chainId));
      if (isSweepPost(input, init)) return json({ sweepId: 'should-never-happen', status: 'pending' });
      return json({ error: `unexpected request: ${url}` }, 500);
    }

    // Anything else is a chain RPC.
    rpcUrls.push(normalize(url));
    return rpcResponse(String(init?.body), { nonce: opts.rpcNonce, chainId: opts.chainId });
  });
  return rpcUrls;
}

function normalize(url: string): string {
  return new URL(url).href;
}

function sweepCalls() {
  return mockFetch.mock.calls.filter(([input, init]) => isSweepPost(input, init));
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

    const result = await agent.sweep({ fromChainId: chainId, toChainId: chainId }, { dryRun: true });

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

    const result = await agent.sweep({ fromChainId: 146, toChainId: 146 }, { dryRun: true });

    expect(result.success).toBe(true);
    expect(new Set(rpcUrls)).toEqual(new Set([normalize('https://my-sonic-rpc.example')]));
  });

  it('fails closed on a chain with no known RPC instead of guessing', async () => {
    const rpcUrls = installRoutes({ chainId: 999999, quotedNonce: 0, rpcNonce: 0 });
    const agent = new ZeroDustAgent({ account, environment: 'mainnet' });

    const result = await agent.sweep({ fromChainId: 999999, toChainId: 999999 });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No default RPC for chain 999999/);
    expect(rpcUrls).toHaveLength(0);
    expect(sweepCalls()).toHaveLength(0);
  });

  it('refuses to submit when the signed nonce disagrees with the quote', async () => {
    // e.g. an RPC for the wrong chain: the account's nonce there is different
    installRoutes({ chainId: 146, quotedNonce: 99, rpcNonce: 359 });
    const agent = new ZeroDustAgent({ account, environment: 'mainnet' });

    const result = await agent.sweep({ fromChainId: 146, toChainId: 146 });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nonce 359 does not match the quote's 99 on chain 146/);
    expect(sweepCalls()).toHaveLength(0);
  });
});
