/**
 * @fileoverview Tests for the agent dry-run path
 *
 * The point of a dry run is that it is indistinguishable from a real sweep
 * right up until submission, and then submits nothing. These tests assert both
 * halves of that: the signatures are really produced, and `POST /sweep` is
 * never called.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { type Address, type Hex, keccak256, recoverTypedDataAddress } from 'viem';
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
  relayAnswer,
  relayDepositData,
} from './helpers/sweep-api.js';

const METAMASK_DELEGATE = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b';
const METAMASK_DESIGNATOR = `0xef0100${METAMASK_DELEGATE.slice(2)}`;

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
    /** Relay's answer to the agent's own request (default: the deposit for the quote's amount) */
    relay?: (body: { amount: string; recipient: Address }) => unknown;
    /** The wallet's code on the source chain (default: none) */
    code?: string;
    /** What the API binds (default: exactly what the agent sent) */
    bind?: (body: { callTarget: string; callData: string }) => { callTarget: string; callData: string };
  } = {}
) {
  let quote = opts.quote ?? makeQuote({ route: 'relay' });
  const authorization = opts.authorization ?? ((q: QuoteResponse) => makeAuthorization(q, 8453));
  mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.startsWith('https://api.relay.link/quote')) {
      const body = JSON.parse(String(init?.body)) as { amount: string; recipient: Address };
      return json(opts.relay ? opts.relay(body) : relayAnswer(body));
    }
    if (url.includes('api.zerodust.xyz')) {
      if (url.includes('/relay-route')) {
        const sent = JSON.parse(String(init?.body)) as { callTarget: string; callData: string };
        const stored = opts.bind ? opts.bind(sent) : sent;
        // The API now serves the bound route, as the backend stores it
        quote = { ...quote, intent: { ...quote.intent, callTarget: stored.callTarget.toLowerCase() as Address, callData: stored.callData, routeHash: keccak256(stored.callData as Hex) } };
        return json({ quoteId: quote.quoteId, intent: quote.intent });
      }
      if (url.includes('/quote')) return json(quote);
      if (url.includes('/authorization')) return json(authorization(quote));
      if (isSweepPost(input, init)) {
        return opts.onSweep ? opts.onSweep() : json({ sweepId: 'swept-1', status: 'pending' });
      }
      return json({ status: 'completed', txHash: '0xabc' });
    }
    if (url.includes('gas.zip')) return gasZipChains();
    if (init?.method === 'POST') return rpcResponse(String(init.body), { nonce: 7, code: opts.code });

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
    // data for the bound route (the deposit Relay gave the agent), i.e. the backend will accept it.
    const bound = { ...quote, intent: { ...quote.intent, routeHash: keccak256(relayDepositData()) } };
    const api = makeAuthorization(bound, 8453).typedData;
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

  it('signs the closing authorization to address(0) for a plain wallet', async () => {
    installRoutes();
    const sigs = (await makeAgent().sweep(SWEEP, { dryRun: true })).signatures!;
    expect(sigs.revoke.contractAddress.toLowerCase()).toBe('0x0000000000000000000000000000000000000000');
  });

  // A key sweep must not undo MetaMask's smart-account upgrade (the owner paid gas for it)
  it('signs the closing authorization back to MetaMask\'s delegate when the wallet is a MetaMask smart account', async () => {
    installRoutes({ code: METAMASK_DESIGNATOR });
    const sigs = (await makeAgent().sweep(SWEEP, { dryRun: true })).signatures!;
    expect(sigs.revoke).toMatchObject({ chainId: 8453, nonce: 8 });
    expect(sigs.revoke.contractAddress.toLowerCase()).toBe(METAMASK_DELEGATE);
    const signer = await recoverAuthorizationAddress({
      authorization: { address: sigs.revoke.contractAddress, chainId: sigs.revoke.chainId, nonce: sigs.revoke.nonce },
      signature: { r: sigs.revoke.r, s: sigs.revoke.s, yParity: sigs.revoke.yParity },
    });
    expect(signer).toBe(account.address);
  });

  // 0.5.11 signed the restore but its own submitSweep check refused it: test through submission
  it('submits the restore for a MetaMask smart account (not only signs it)', async () => {
    installRoutes({ code: METAMASK_DESIGNATOR });
    const result = await makeAgent().sweep(SWEEP, { waitForCompletion: false });
    expect(result.success).toBe(true);
    const [, init] = sweepCalls()[0]!;
    const body = JSON.parse(String((init as RequestInit).body)) as { revokeAuthorization: { contractAddress: string } };
    expect(body.revokeAuthorization.contractAddress.toLowerCase()).toBe(METAMASK_DELEGATE);
  });

  it('never puts back an unknown delegation (it may be a drainer\'s)', async () => {
    installRoutes({ code: `0xef0100${'de'.repeat(20)}` });
    const sigs = (await makeAgent().sweep(SWEEP, { dryRun: true })).signatures!;
    expect(sigs.revoke.contractAddress.toLowerCase()).toBe('0x0000000000000000000000000000000000000000');
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
    // A Relay route with a matching amount, so the fee check (not the amount check) refuses it
    const quote = makeQuote({ route: 'relay' });
    quote.fees.maxTotalFeeWei = (BigInt(quote.userBalance) / 2n).toString();
    quote.bridge = { ...quote.bridge!, inputAmount: (BigInt(quote.userBalance) - BigInt(quote.fees.maxTotalFeeWei)).toString() };
    installRoutes({ quote });
    expectRefused(await new ZeroDustAgent({ account }).sweep(SWEEP, { dryRun: true }), /fee reserve/);
  });

  it('a Relay deposit paying someone else, or not native gas, or less than shown', async () => {
    installRoutes({ relay: (b) => relayAnswer({ ...b, recipient: ATTACKER }) });
    expectRefused(await new ZeroDustAgent({ account, environment: 'mainnet' }).sweep(SWEEP), /Relay would pay/);
    installRoutes({ relay: (b) => ({ ...relayAnswer(b), details: { ...relayAnswer(b).details, currencyOut: { amount: '1', currency: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', chainId: 42161 } } } }) });
    expectRefused(await new ZeroDustAgent({ account, environment: 'mainnet' }).sweep(SWEEP), /native gas/);
    installRoutes({ relay: (b) => relayAnswer({ ...b, amountOut: '1' }) });
    expectRefused(await new ZeroDustAgent({ account, environment: 'mainnet' }).sweep(SWEEP), /less than the amount shown/);
  });

  it('a Relay amount that is not the balance less the signed fee reserve', async () => {
    const quote = makeQuote({ route: 'relay' });
    quote.bridge = { ...quote.bridge!, inputAmount: (BigInt(quote.bridge!.inputAmount) / 2n).toString() };
    installRoutes({ quote });
    expectRefused(await new ZeroDustAgent({ account, environment: 'mainnet' }).sweep(SWEEP), /not the \d+ wei the balance leaves after fees/);
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes('api.relay.link'))).toBe(false);
  });

  it('an API that binds another deposit than the one Relay gave the agent', async () => {
    installRoutes({ bind: (sent) => ({ ...sent, callData: relayDepositData(ATTACKER) }) });
    expectRefused(await new ZeroDustAgent({ account, environment: 'mainnet' }).sweep(SWEEP), /did not bind the deposit/);
  });

  it('a Relay route without a route token, whatever the API labels it', async () => {
    const quote = makeQuote({ route: 'relay' });
    delete (quote as { relayRouteToken?: string }).relayRouteToken;
    delete (quote as { bridge?: unknown }).bridge;
    installRoutes({ quote });
    expectRefused(await new ZeroDustAgent({ account, environment: 'mainnet' }).sweep(SWEEP), /cannot be fetched from Relay/);
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes('api.relay.link'))).toBe(false);
  });

  it('accepts a Relay route it fetched from Relay itself, even with requireVerifiedRoute', async () => {
    installRoutes();
    const agent = new ZeroDustAgent({ account, requireVerifiedRoute: true });
    const result = await agent.sweep(SWEEP, { dryRun: true });
    expect(result.error).toBeUndefined();
    const relayCall = mockFetch.mock.calls.find(([u]) => String(u) === 'https://api.relay.link/quote')!;
    expect(JSON.parse(String((relayCall[1] as RequestInit).body))).toMatchObject({ user: account.address, recipient: account.address, refundTo: account.address, originChainId: 8453, destinationChainId: 42161, tradeType: 'EXACT_INPUT' });
    const bindCall = mockFetch.mock.calls.find(([u]) => String(u).endsWith('/relay-route'))!;
    expect(JSON.parse(String((bindCall[1] as RequestInit).body))).toMatchObject({ callData: relayDepositData(), routeToken: 'a'.repeat(64) });
  });

  it('accepts a verified Gas.zip route with requireVerifiedRoute', async () => {
    installRoutes({ quote: makeQuote({ route: 'gaszip' }) });
    const agent = new ZeroDustAgent({ account, requireVerifiedRoute: true });
    const result = await agent.sweep(SWEEP, { dryRun: true });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });
});
