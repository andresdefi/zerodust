/**
 * @fileoverview Tests for the agent dry-run path
 *
 * The point of a dry run is that it is indistinguishable from a real sweep
 * right up until submission, and then submits nothing. These tests assert both
 * halves of that: the signatures are really produced, and `POST /sweep` is
 * never called.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recoverTypedDataAddress } from 'viem';
import { recoverAuthorizationAddress } from 'viem/utils';
import { ZeroDustAgent } from '../src/agent.js';
import type { AuthorizationResponse, QuoteResponse } from '../src/types.js';
import {
  account,
  makeQuote,
  makeAuthorization,
  json,
  rpcResponse,
  gasZipChains,
  isSweepPost,
  QUOTE_ID,
  ZERODUST as CONTRACT,
  ATTACKER,
} from './helpers/sweep-api.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * Routes every call a sweep makes: the ZeroDust API, Gas.zip's chain list and
 * the source chain's RPC (Base: nonce 7, the recorded balance and gas price).
 */
function installRoutes(
  opts: {
    quote?: QuoteResponse;
    authorization?: (quote: QuoteResponse) => AuthorizationResponse;
    onSweep?: () => Promise<Response>;
  } = {}
) {
  const quote = opts.quote ?? makeQuote({ route: 'relay' });
  const authorization = opts.authorization ?? ((q: QuoteResponse) => makeAuthorization(q, 8453));
  mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('api.zerodust.xyz')) {
      if (url.includes('/quote')) return json(quote);
      if (url.includes('/authorization')) return json(authorization(quote));
      if (isSweepPost(input, init)) {
        return opts.onSweep ? opts.onSweep() : json({ sweepId: 'swept-1', status: 'pending' });
      }
      return json({ status: 'completed', txHash: '0xabc' });
    }
    if (url.includes('gas.zip')) return gasZipChains();
    if (init?.method === 'POST') return rpcResponse(String(init.body), { nonce: 7 });

    return json({ error: `unexpected request: ${url}` }, 500);
  });
}

function sweepCalls() {
  return mockFetch.mock.calls.filter(([input, init]) => isSweepPost(input, init));
}

const SWEEP = { fromChainId: 8453, toChainId: 42161 };

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
      SWEEP,
      { dryRun: true }
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
  });

  it('never submits the sweep', async () => {
    await makeAgent().sweep(SWEEP, { dryRun: true });

    expect(sweepCalls()).toHaveLength(0);
  });

  it('produces no sweepId, because nothing was submitted', async () => {
    const result = await makeAgent().sweep(
      SWEEP,
      { dryRun: true }
    );

    expect(result.sweepId).toBeUndefined();
    expect(result.txHash).toBeUndefined();
  });

  it('returns the real quote so callers can show what would happen', async () => {
    const result = await makeAgent().sweep(
      SWEEP,
      { dryRun: true }
    );

    expect(result.quote?.quoteId).toBe(QUOTE_ID);
    expect(result.quote?.estimatedReceive).toBe('529832916922592715');
  });

  it('produces all three real signatures', async () => {
    const result = await makeAgent().sweep(
      SWEEP,
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

  it('signs the locally built intent, the ZeroDust delegation and the revoke', async () => {
    const quote = makeQuote({ route: 'relay' });
    installRoutes({ quote });
    const result = await makeAgent().sweep(SWEEP, { dryRun: true });
    const sigs = result.signatures!;

    // The intent signature recovers to the account over the API's own typed
    // data, i.e. the backend will accept it.
    const api = makeAuthorization(quote, 8453).typedData;
    const recovered = await recoverTypedDataAddress({
      domain: api.domain,
      types: { SweepIntent: api.types.SweepIntent },
      primaryType: 'SweepIntent',
      message: api.message,
      signature: sigs.intent,
    });
    expect(recovered).toBe(account.address);

    const delegationSigner = await recoverAuthorizationAddress({
      authorization: { address: sigs.delegation.contractAddress, chainId: sigs.delegation.chainId, nonce: sigs.delegation.nonce },
      signature: { r: sigs.delegation.r, s: sigs.delegation.s, yParity: sigs.delegation.yParity },
    });
    expect(delegationSigner).toBe(account.address);
    expect(sigs.delegation).toMatchObject({ chainId: 8453, contractAddress: CONTRACT, nonce: 7 });
    expect(sigs.revoke).toMatchObject({ chainId: 8453, nonce: 8 });
  });

  it('still submits when dryRun is not set', async () => {
    const result = await makeAgent().sweep(SWEEP, { waitForCompletion: false });

    expect(result.error).toBeUndefined();
    expect(result.dryRun).toBeUndefined();
    expect(sweepCalls().length).toBeGreaterThan(0);
  });
});

describe('ZeroDustAgent refuses an untrusted API before signing', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  function expectRefused(result: Awaited<ReturnType<ZeroDustAgent['sweep']>>, pattern: RegExp) {
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^Refusing to sign/);
    expect(result.error).toMatch(pattern);
    expect(result.signatures).toBeUndefined();
    expect(sweepCalls()).toHaveLength(0);
  }

  it('a delegation target other than the ZeroDust contract', async () => {
    installRoutes({
      authorization: (q) => ({ ...makeAuthorization(q, 8453), contractAddress: ATTACKER }),
    });
    const result = await new ZeroDustAgent({ account }).sweep(SWEEP);
    expectRefused(result, /not the ZeroDust contract/);
  });

  it('API typed data for a different domain or type', async () => {
    installRoutes({
      authorization: (q) => {
        const auth = makeAuthorization(q, 8453);
        auth.typedData.domain = { ...auth.typedData.domain, name: 'Permit2' };
        return auth;
      },
    });
    expectRefused(await new ZeroDustAgent({ account }).sweep(SWEEP), /domain differs/);
  });

  it('a quote that pays another address', async () => {
    installRoutes({ quote: makeQuote({ route: 'relay', destination: ATTACKER }) });
    expectRefused(await new ZeroDustAgent({ account }).sweep(SWEEP), /is not the requested/);
  });

  it('an unknown bridge call target', async () => {
    const quote = makeQuote({ route: 'relay' });
    quote.intent.callTarget = ATTACKER;
    installRoutes({ quote });
    expectRefused(await new ZeroDustAgent({ account }).sweep(SWEEP), /not a known bridge contract/);
  });

  it('an excessive fee, even on a dry run', async () => {
    const quote = makeQuote({ route: 'relay' });
    quote.fees.maxTotalFeeWei = (BigInt(quote.userBalance) / 2n).toString();
    installRoutes({ quote });
    expectRefused(await new ZeroDustAgent({ account }).sweep(SWEEP, { dryRun: true }), /fee reserve/);
  });

  it('a Relay route when requireVerifiedRoute is set', async () => {
    installRoutes();
    const agent = new ZeroDustAgent({ account, requireVerifiedRoute: true });
    expectRefused(await agent.sweep(SWEEP), /cannot be verified/);
  });

  it('accepts a verified Gas.zip route with requireVerifiedRoute', async () => {
    installRoutes({ quote: makeQuote({ route: 'gaszip' }) });
    const agent = new ZeroDustAgent({ account, requireVerifiedRoute: true });
    const result = await agent.sweep(SWEEP, { dryRun: true });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });
});
