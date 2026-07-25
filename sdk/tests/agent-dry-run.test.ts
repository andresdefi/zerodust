/**
 * @fileoverview Tests for the agent dry-run path
 *
 * The point of a dry run is that it is indistinguishable from a real sweep
 * right up until submission, and then submits nothing. These tests assert both
 * halves of that: the signatures are really produced, and `POST /sweep` is
 * never called.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { ZeroDustAgent } from '../src/agent.js';

// Deterministic throwaway key. Never funded, never used anywhere else.
const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const account = privateKeyToAccount(TEST_KEY);

const QUOTE_ID = '3f7c1a2e-8b4d-4f6a-9c2e-1d5b7a3e9f04';
const CONTRACT = '0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2';

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

const quoteResponse = {
  quoteId: QUOTE_ID,
  version: 3,
  userBalance: '1000000000000000',
  estimatedReceive: '970000000000000',
  mode: 1,
  fees: {},
  autoRevoke: true,
  intent: {},
  deadline: 4102444800,
  nonce: 0,
  authNonce: 7,
  validForSeconds: 55,
};

const authorizationResponse = {
  sweepType: 'cross-chain',
  contractAddress: CONTRACT,
  version: 3,
  typedData: {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      SweepIntent: [
        { name: 'destination', type: 'address' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'SweepIntent',
    domain: {
      name: 'ZeroDust',
      version: '3',
      chainId: 42161,
      verifyingContract: account.address,
    },
    message: {
      destination: account.address,
      deadline: '4102444800',
    },
  },
};

/**
 * Routes the three kinds of call a sweep makes: the ZeroDust API, and the
 * chain RPC that viem hits to look up the authorization nonce.
 */
function installRoutes() {
  mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/quote')) return json(quoteResponse);
    if (url.includes('/authorization')) return json(authorizationResponse);

    // viem's http transport posting eth_getTransactionCount
    if (init?.method === 'POST' && url.includes('arbitrum')) {
      const body = JSON.parse(String(init.body)) as { id: number };
      return json({ jsonrpc: '2.0', id: body.id, result: '0x7' });
    }

    return json({ error: `unexpected request: ${url}` }, 500);
  });
}

function sweepCalls() {
  return mockFetch.mock.calls.filter(([input, init]) => {
    const url = typeof input === 'string' ? input : String(input);
    // POST /sweep, not GET /sweep/:id and not /quote
    return (init as RequestInit | undefined)?.method === 'POST' && /\/sweep$/.test(url.split('?')[0] ?? '');
  });
}

describe('ZeroDustAgent dry run', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    installRoutes();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeAgent() {
    return new ZeroDustAgent({ account, environment: 'mainnet' });
  }

  it('returns a successful result flagged as a dry run', async () => {
    const result = await makeAgent().sweep(
      { fromChainId: 42161, toChainId: 8453 },
      { dryRun: true }
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
  });

  it('never submits the sweep', async () => {
    await makeAgent().sweep({ fromChainId: 42161, toChainId: 8453 }, { dryRun: true });

    expect(sweepCalls()).toHaveLength(0);
  });

  it('produces no sweepId, because nothing was submitted', async () => {
    const result = await makeAgent().sweep(
      { fromChainId: 42161, toChainId: 8453 },
      { dryRun: true }
    );

    expect(result.sweepId).toBeUndefined();
    expect(result.txHash).toBeUndefined();
  });

  it('returns the real quote so callers can show what would happen', async () => {
    const result = await makeAgent().sweep(
      { fromChainId: 42161, toChainId: 8453 },
      { dryRun: true }
    );

    expect(result.quote?.quoteId).toBe(QUOTE_ID);
    expect(result.quote?.estimatedReceive).toBe('970000000000000');
  });

  it('produces all three real signatures', async () => {
    const result = await makeAgent().sweep(
      { fromChainId: 42161, toChainId: 8453 },
      { dryRun: true }
    );

    expect(result.signatures?.intent).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(result.signatures?.delegation.contractAddress).toBe(CONTRACT);
    expect(result.signatures?.delegation.r).toMatch(/^0x[0-9a-f]{64}$/i);

    // The revoke authorization delegates to the zero address at nonce + 1,
    // which is what undoes the delegation after the sweep.
    expect(result.signatures?.revoke.contractAddress).toBe(
      '0x0000000000000000000000000000000000000000'
    );
    expect(result.signatures?.revoke.nonce).toBe(
      (result.signatures?.delegation.nonce ?? 0) + 1
    );
  });

  it('still submits when dryRun is not set', async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/quote')) return json(quoteResponse);
      if (url.includes('/authorization')) return json(authorizationResponse);
      if (init?.method === 'POST' && url.includes('arbitrum')) {
        const body = JSON.parse(String(init.body)) as { id: number };
        return json({ jsonrpc: '2.0', id: body.id, result: '0x7' });
      }
      if (init?.method === 'POST') return json({ sweepId: 'swept-1', status: 'pending' });
      return json({ status: 'completed', txHash: '0xabc' });
    });

    const result = await makeAgent().sweep(
      { fromChainId: 42161, toChainId: 8453 },
      { waitForCompletion: false }
    );

    expect(result.dryRun).toBeUndefined();
    expect(sweepCalls().length).toBeGreaterThan(0);
  });
});
