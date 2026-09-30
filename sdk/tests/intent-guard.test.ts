/**
 * @fileoverview Tests for the checks that run before anything is signed
 *
 * Each rejection path models a malicious or broken API response. The happy
 * paths use quote numbers recorded from the live API (see helpers/sweep-api.ts)
 * and prove the locally built typed data hashes to exactly what the API's own
 * typed data would, so honest quotes keep working.
 */

import { describe, it, expect } from 'vitest';
import { type Address, type Hex, encodeFunctionData, hashTypedData, keccak256, parseAbi } from 'viem';
import {
  verifySweepQuote,
  assertAuthorizationMatches,
  assertSignedAuthorization,
  maxAcceptableFeeWei,
  type QuoteCheckContext,
} from '../src/utils/intent-guard.js';
import {
  bridgeForCallTarget,
  buildGasZipDepositCalldata,
  createGasZipChainShortResolver,
} from '../src/utils/bridge-targets.js';
import { isZeroDustError } from '../src/errors.js';
import type { QuoteResponse } from '../src/types.js';
import {
  account,
  makeQuote,
  makeAuthorization,
  nowSeconds,
  ATTACKER,
  ACROSS_PERIPHERY,
  BASE_BALANCE,
  BASE_GAS_PRICE,
  GASZIP_SHORTS,
  ZERO,
  ZERODUST,
  EMPTY_ROUTE,
} from './helpers/sweep-api.js';

function ctx(overrides: Partial<QuoteCheckContext> = {}): QuoteCheckContext {
  return {
    signer: account.address,
    fromChainId: 8453,
    toChainId: 8453,
    destination: account.address,
    balanceWei: BASE_BALANCE,
    gasPriceWei: BASE_GAS_PRICE,
    nowSeconds: nowSeconds(),
    resolveGasZipChainShort: async (chainId) => GASZIP_SHORTS[chainId],
    ...overrides,
  };
}

const crossCtx = (overrides: Partial<QuoteCheckContext> = {}) => ctx({ toChainId: 42161, ...overrides });

/** A deep copy with one change */
function tamper(quote: QuoteResponse, change: (q: QuoteResponse) => void): QuoteResponse {
  const copy = JSON.parse(JSON.stringify(quote)) as QuoteResponse;
  change(copy);
  return copy;
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(isZeroDustError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('UNSAFE_QUOTE');
    return (error as Error).message;
  }
  throw new Error('expected the quote to be refused');
}

function syncRejection(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    expect((error as { code: string }).code).toBe('UNSAFE_QUOTE');
    return (error as Error).message;
  }
  throw new Error('expected a refusal');
}

describe('verifySweepQuote: happy paths (recorded live quotes)', () => {
  it('same-chain transfer: builds the ZeroDust v3 typed data locally', async () => {
    const quote = makeQuote();
    const { typedData, route } = await verifySweepQuote(quote, ctx());

    expect(typedData.domain).toEqual({
      name: 'ZeroDust',
      version: '3',
      chainId: 8453,
      verifyingContract: account.address,
    });
    expect(typedData.primaryType).toBe('SweepIntent');
    expect(typedData.message.user).toBe(account.address);
    expect(typedData.message.mode).toBe(0);
    expect(typedData.message.callTarget).toBe(ZERO);
    expect(typedData.message.routeHash).toBe(EMPTY_ROUTE);
    expect(route).toEqual({ bridge: null, recipientVerified: true });
  });

  it('hashes to exactly the digest of the API typed data, so honest sweeps still verify', async () => {
    for (const route of ['transfer', 'relay', 'gaszip'] as const) {
      const quote = makeQuote({ route });
      const context = route === 'transfer' ? ctx() : crossCtx();
      const { typedData } = await verifySweepQuote(quote, context);
      const api = makeAuthorization(quote, 8453).typedData;

      expect(() => assertAuthorizationMatches(makeAuthorization(quote, 8453), typedData)).not.toThrow();
      expect(hashTypedData(typedData)).toBe(
        hashTypedData({
          domain: api.domain,
          types: { SweepIntent: api.types.SweepIntent },
          primaryType: 'SweepIntent',
          message: api.message,
        })
      );
    }
  });

  it('the typehash string matches the contract', async () => {
    const { typedData } = await verifySweepQuote(makeQuote(), ctx());
    const signature = `SweepIntent(${typedData.types.SweepIntent.map((f) => `${f.type} ${f.name}`).join(',')})`;
    expect(signature).toBe(
      'SweepIntent(uint8 mode,address user,address destination,uint256 destinationChainId,address callTarget,bytes32 routeHash,uint256 minReceive,uint256 maxTotalFeeWei,uint256 overheadGasUnits,uint256 protocolFeeGasUnits,uint256 extraFeeWei,uint256 reimbGasPriceCapWei,uint256 deadline,uint256 nonce)'
    );
  });

  it('Relay route: accepted as a known bridge, recipient not verifiable', async () => {
    const { route } = await verifySweepQuote(makeQuote({ route: 'relay' }), crossCtx());
    expect(route).toEqual({ bridge: 'relay', recipientVerified: false });
  });

  it('Gas.zip route: the calldata is rebuilt and the recipient verified', async () => {
    const { route } = await verifySweepQuote(makeQuote({ route: 'gaszip' }), crossCtx());
    expect(route).toEqual({ bridge: 'gaszip', recipientVerified: true });
  });

  it('accepts a destination other than the signer when that is what was asked', async () => {
    const other = '0x1111111111111111111111111111111111111111' as Address;
    const { typedData } = await verifySweepQuote(makeQuote({ destination: other }), ctx({ destination: other }));
    expect(typedData.message.destination).toBe(other);
    expect(typedData.message.user).toBe(account.address);
  });
});

describe('verifySweepQuote: destination and chain (CRITICAL-2)', () => {
  it('refuses a quote that pays someone other than the requested destination', async () => {
    const quote = makeQuote({ destination: ATTACKER });
    expect(await rejection(verifySweepQuote(quote, ctx()))).toMatch(/destination .* is not the requested/);
  });

  it('refuses a cross-chain quote to another destination chain', async () => {
    const quote = tamper(makeQuote({ route: 'gaszip' }), (q) => {
      q.intent.destinationChainId = '10';
    });
    expect(await rejection(verifySweepQuote(quote, crossCtx()))).toMatch(/destination chain 10 is not the requested 42161/);
  });

  it('refuses a zero destination', async () => {
    const quote = makeQuote({ destination: ZERO });
    expect(await rejection(verifySweepQuote(quote, ctx({ destination: ZERO })))).toMatch(/zero address/);
  });

  it('refuses malformed fields', async () => {
    const quote = tamper(makeQuote(), (q) => {
      (q.fees as { maxTotalFeeWei: string }).maxTotalFeeWei = '1e18';
    });
    expect(await rejection(verifySweepQuote(quote, ctx()))).toMatch(/maxTotalFeeWei is not an unsigned integer/);
    expect(await rejection(verifySweepQuote({} as QuoteResponse, ctx()))).toMatch(/no intent/);
  });
});

describe('verifySweepQuote: mode and call target (CRITICAL-2)', () => {
  it('refuses a same-chain quote in call mode', async () => {
    const quote = tamper(makeQuote(), (q) => {
      q.mode = 1;
      q.intent.mode = 1;
    });
    expect(await rejection(verifySweepQuote(quote, ctx()))).toMatch(/must be a transfer/);
  });

  it('refuses a same-chain transfer that carries a call target or route', async () => {
    const withTarget = tamper(makeQuote(), (q) => {
      q.intent.callTarget = ATTACKER;
    });
    expect(await rejection(verifySweepQuote(withTarget, ctx()))).toMatch(/has a call target/);

    const withRoute = tamper(makeQuote(), (q) => {
      q.intent.routeHash = keccak256('0x1234');
    });
    expect(await rejection(verifySweepQuote(withRoute, ctx()))).toMatch(/non-empty route/);
  });

  it('refuses a cross-chain quote in transfer mode', async () => {
    const quote = tamper(makeQuote({ route: 'relay' }), (q) => {
      q.mode = 0;
      q.intent.mode = 0;
    });
    expect(await rejection(verifySweepQuote(quote, crossCtx()))).toMatch(/must be a bridge call/);
  });

  it('refuses a top-level mode that disagrees with the intent', async () => {
    const quote = tamper(makeQuote(), (q) => {
      q.mode = 1;
    });
    expect(await rejection(verifySweepQuote(quote, ctx()))).toMatch(/disagrees/);
  });

  it('refuses an unknown call target', async () => {
    const quote = tamper(makeQuote({ route: 'relay' }), (q) => {
      q.intent.callTarget = ATTACKER;
    });
    expect(await rejection(verifySweepQuote(quote, crossCtx()))).toMatch(/not a known bridge contract on chain 8453/);
  });

  it('refuses a bridge contract on a chain where that bridge is not deployed', async () => {
    // Across's periphery exists on Base but not on Gnosis
    expect(bridgeForCallTarget(8453, ACROSS_PERIPHERY)).toBe('across');
    expect(bridgeForCallTarget(100, ACROSS_PERIPHERY)).toBeNull();

    const quote = tamper(makeQuote({ route: 'relay', fromChainId: 100 }), (q) => {
      q.intent.callTarget = ACROSS_PERIPHERY;
    });
    expect(await rejection(verifySweepQuote(quote, crossCtx({ fromChainId: 100 })))).toMatch(/not a known bridge contract on chain 100/);
  });

  it('refuses unverifiable routes when requireVerifiedRoute is set', async () => {
    const message = await rejection(
      verifySweepQuote(makeQuote({ route: 'relay' }), crossCtx({ requireVerifiedRoute: true }))
    );
    expect(message).toMatch(/relay route's recipient cannot be verified/);

    // Gas.zip is verified, so it still passes
    const ok = await verifySweepQuote(makeQuote({ route: 'gaszip' }), crossCtx({ requireVerifiedRoute: true }));
    expect(ok.route.recipientVerified).toBe(true);
  });
});

describe('verifySweepQuote: route hash (CRITICAL-2)', () => {
  it('refuses a Gas.zip route whose calldata deposits to someone else', async () => {
    const quote = tamper(makeQuote({ route: 'gaszip' }), (q) => {
      q.intent.routeHash = keccak256(buildGasZipDepositCalldata(GASZIP_SHORTS[42161]!, ATTACKER));
    });
    expect(await rejection(verifySweepQuote(quote, crossCtx()))).toMatch(/does not deposit to .* on chain 42161/);
  });

  it('refuses a Gas.zip route that deposits on another chain', async () => {
    const quote = tamper(makeQuote({ route: 'gaszip' }), (q) => {
      q.intent.routeHash = keccak256(buildGasZipDepositCalldata(GASZIP_SHORTS[56]!, account.address));
    });
    expect(await rejection(verifySweepQuote(quote, crossCtx()))).toMatch(/does not deposit/);
  });

  it('refuses a Gas.zip route when Gas.zip cannot confirm the chain', async () => {
    const message = await rejection(
      verifySweepQuote(makeQuote({ route: 'gaszip' }), crossCtx({ resolveGasZipChainShort: async () => undefined }))
    );
    expect(message).toMatch(/cannot verify the Gas.zip route/);
  });

  it('refuses supplied calldata that does not hash to routeHash', async () => {
    const quote = tamper(makeQuote({ route: 'gaszip' }), (q) => {
      q.intent.callData = buildGasZipDepositCalldata(GASZIP_SHORTS[42161]!, ATTACKER);
    });
    expect(await rejection(verifySweepQuote(quote, crossCtx()))).toMatch(/routeHash is not keccak256/);
  });

  describe('Across calldata, when the API supplies it', () => {
    const abi = parseAbi([
      'function depositNative(address spokePool, address depositor, bytes32 recipient, address inputToken, uint256 inputAmount, bytes32 outputToken, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message)',
    ]);
    const pad = (a: Address) => `0x${a.slice(2).padStart(64, '0')}` as Hex;

    function acrossQuote(p: { recipient: Address; depositor?: Address; chainId?: bigint; message?: Hex }) {
      const callData = encodeFunctionData({
        abi,
        functionName: 'depositNative',
        args: [
          '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64',
          p.depositor ?? account.address,
          pad(p.recipient),
          '0x4200000000000000000000000000000000000006',
          1000n,
          pad('0x82af49447d8a07e3bd95bd0d56f35241523fbab1'),
          990n,
          p.chainId ?? 42161n,
          pad(ZERO),
          0,
          0,
          0,
          p.message ?? '0x',
        ],
      });
      return tamper(makeQuote({ route: 'relay' }), (q) => {
        q.intent.callTarget = ACROSS_PERIPHERY;
        q.intent.callData = callData;
        q.intent.routeHash = keccak256(callData);
      });
    }

    it('verifies the recipient', async () => {
      const { route } = await verifySweepQuote(acrossQuote({ recipient: account.address }), crossCtx());
      expect(route).toEqual({ bridge: 'across', recipientVerified: true });
    });

    it('refuses a deposit to another recipient', async () => {
      expect(await rejection(verifySweepQuote(acrossQuote({ recipient: ATTACKER }), crossCtx()))).toMatch(/Across deposit pays/);
    });

    it('refuses a deposit whose refunds go to someone else', async () => {
      const quote = acrossQuote({ recipient: account.address, depositor: ATTACKER });
      expect(await rejection(verifySweepQuote(quote, crossCtx()))).toMatch(/refunds to/);
    });

    it('refuses a deposit to another chain', async () => {
      const quote = acrossQuote({ recipient: account.address, chainId: 10n });
      expect(await rejection(verifySweepQuote(quote, crossCtx()))).toMatch(/goes to chain 10/);
    });

    it('treats a destination-side swap as unverified, not verified', async () => {
      const quote = acrossQuote({ recipient: ATTACKER, message: '0x1234' });
      const { route } = await verifySweepQuote(quote, crossCtx());
      expect(route.recipientVerified).toBe(false);
      await rejection(verifySweepQuote(quote, crossCtx({ requireVerifiedRoute: true })));
    });
  });
});

describe('verifySweepQuote: fees, gas price and deadline (HIGH-1)', () => {
  it('refuses a fee reserve above the limit', async () => {
    const limit = maxAcceptableFeeWei({ chainId: 8453, balanceWei: BASE_BALANCE, reimbGasPriceCapWei: 7_200_000n });
    const quote = tamper(makeQuote(), (q) => {
      q.fees.maxTotalFeeWei = (limit + 1n).toString();
    });
    expect(await rejection(verifySweepQuote(quote, ctx()))).toMatch(/exceeds the \d+ wei limit/);
  });

  it('sizes the limit from the locally read balance, not the quote', async () => {
    // The quote claims a huge balance to widen the percentage allowance
    const quote = tamper(makeQuote(), (q) => {
      q.userBalance = (BASE_BALANCE * 1000n).toString();
      q.fees.maxTotalFeeWei = (BASE_BALANCE / 10n).toString();
    });
    await rejection(verifySweepQuote(quote, ctx()));
  });

  it('refuses a fee reserve that takes the whole balance', async () => {
    const quote = makeQuote();
    const message = await rejection(verifySweepQuote(quote, ctx({ balanceWei: 188001206483832n })));
    expect(message).toMatch(/would take the whole balance/);
  });

  it('refuses an extraFeeWei larger than the reserve', async () => {
    const quote = tamper(makeQuote(), (q) => {
      q.fees.extraFeeWei = (BigInt(q.fees.maxTotalFeeWei) + 1n).toString();
    });
    expect(await rejection(verifySweepQuote(quote, ctx()))).toMatch(/extraFeeWei exceeds/);
  });

  it('refuses overhead or protocol fee units above the contract maxima', async () => {
    const overhead = tamper(makeQuote(), (q) => {
      q.fees.overheadGasUnits = '300001';
    });
    expect(await rejection(verifySweepQuote(overhead, ctx()))).toMatch(/overheadGasUnits/);

    const protocol = tamper(makeQuote(), (q) => {
      q.fees.protocolFeeGasUnits = '100001';
    });
    expect(await rejection(verifySweepQuote(protocol, ctx()))).toMatch(/protocolFeeGasUnits/);
  });

  it('refuses a gas price cap above 3x the local gas price, or zero', async () => {
    const high = tamper(makeQuote(), (q) => {
      q.fees.reimbGasPriceCapWei = (BASE_GAS_PRICE * 3n + 1n).toString();
    });
    expect(await rejection(verifySweepQuote(high, ctx()))).toMatch(/gas price cap/);

    const zero = tamper(makeQuote(), (q) => {
      q.fees.reimbGasPriceCapWei = '0';
    });
    expect(await rejection(verifySweepQuote(zero, ctx()))).toMatch(/gas price cap/);
  });

  it('refuses an expired deadline', async () => {
    const quote = tamper(makeQuote(), (q) => {
      q.deadline = nowSeconds();
    });
    expect(await rejection(verifySweepQuote(quote, ctx()))).toMatch(/deadline has passed/);
  });

  it('refuses a deadline further out than the contract window', async () => {
    const quote = tamper(makeQuote(), (q) => {
      q.deadline = nowSeconds() + 86_400;
    });
    expect(await rejection(verifySweepQuote(quote, ctx()))).toMatch(/more than 60s/);
  });

  it('allows a little clock skew around the 60s window', async () => {
    const quote = tamper(makeQuote(), (q) => {
      q.deadline = nowSeconds() + 65;
    });
    await expect(verifySweepQuote(quote, ctx())).resolves.toBeDefined();
  });
});

describe('assertAuthorizationMatches (CRITICAL-1)', () => {
  async function local() {
    const quote = makeQuote();
    return { quote, typedData: (await verifySweepQuote(quote, ctx())).typedData };
  }

  it('refuses a delegation to any contract but ZeroDust', async () => {
    const { quote, typedData } = await local();
    const auth = { ...makeAuthorization(quote, 8453), contractAddress: ATTACKER };
    expect(syncRejection(() => assertAuthorizationMatches(auth, typedData))).toMatch(/not the ZeroDust contract/);
  });

  it('refuses a foreign domain', async () => {
    const { quote, typedData } = await local();
    for (const domain of [
      { name: 'ZeroDustSweep' },
      { version: '1' },
      { chainId: 1 },
      { verifyingContract: ZERODUST },
    ]) {
      const auth = makeAuthorization(quote, 8453);
      auth.typedData.domain = { ...auth.typedData.domain, ...domain };
      expect(syncRejection(() => assertAuthorizationMatches(auth, typedData))).toMatch(/domain differs/);
    }
  });

  it('refuses different types or primary type', async () => {
    const { quote, typedData } = await local();

    const renamed = makeAuthorization(quote, 8453);
    renamed.typedData.types.SweepIntent = renamed.typedData.types.SweepIntent.map((f) =>
      f.name === 'destination' ? { ...f, name: 'recipient' } : f
    );
    expect(syncRejection(() => assertAuthorizationMatches(renamed, typedData))).toMatch(/type differs/);

    const reordered = makeAuthorization(quote, 8453);
    reordered.typedData.types.SweepIntent = [...reordered.typedData.types.SweepIntent].reverse();
    expect(syncRejection(() => assertAuthorizationMatches(reordered, typedData))).toMatch(/type differs/);

    const permit = makeAuthorization(quote, 8453);
    (permit.typedData as { primaryType: string }).primaryType = 'Permit';
    expect(syncRejection(() => assertAuthorizationMatches(permit, typedData))).toMatch(/not a SweepIntent/);
  });

  it('refuses a message that differs from the verified quote', async () => {
    const { quote, typedData } = await local();
    const auth = makeAuthorization(quote, 8453);
    auth.typedData.message = { ...auth.typedData.message, destination: ATTACKER };
    expect(syncRejection(() => assertAuthorizationMatches(auth, typedData))).toMatch(/field destination differs/);
  });
});

describe('assertSignedAuthorization', () => {
  const signed = { chainId: 8453, contractAddress: ZERODUST, nonce: 7, yParity: 0 as const, r: '0x01' as Hex, s: '0x02' as Hex };

  it('accepts the expected delegation', () => {
    expect(() =>
      assertSignedAuthorization(signed, { contractAddress: ZERODUST, chainId: 8453, nonce: 7 }, 'Delegation')
    ).not.toThrow();
  });

  it('refuses a revoke that does not target address(0), or a wrong chain or nonce', () => {
    expect(syncRejection(() => assertSignedAuthorization(signed, { contractAddress: ZERO, chainId: 8453 }, 'Revoke'))).toMatch(/Revoke authorization targets/);
    expect(syncRejection(() => assertSignedAuthorization(signed, { contractAddress: ZERODUST, chainId: 1 }, 'Delegation'))).toMatch(/for chain 8453/);
    expect(syncRejection(() => assertSignedAuthorization(signed, { contractAddress: ZERODUST, chainId: 8453, nonce: 8 }, 'Revoke'))).toMatch(/nonce is 7/);
  });
});

describe('createGasZipChainShortResolver', () => {
  it('reads short IDs from Gas.zip and caches them', async () => {
    let calls = 0;
    const resolve = createGasZipChainShortResolver(async () => {
      calls++;
      return new Response(JSON.stringify({ chains: [{ chain: 42161, short: 57 }] }), { status: 200 });
    });
    expect(await resolve(42161)).toBe(57);
    expect(await resolve(1)).toBeUndefined();
    expect(calls).toBe(1);
  });

  it('does not cache a failure', async () => {
    let calls = 0;
    const resolve = createGasZipChainShortResolver(async () => {
      calls++;
      return calls === 1
        ? new Response('down', { status: 503 })
        : new Response(JSON.stringify({ chains: [{ chain: 42161, short: 57 }] }), { status: 200 });
    });
    await expect(resolve(42161)).rejects.toThrow(/unavailable/);
    expect(await resolve(42161)).toBe(57);
  });
});
