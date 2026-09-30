/**
 * @fileoverview A realistic ZeroDust API and chain RPC for agent tests
 *
 * Quote numbers are from live `GET /quote` + `POST /authorization` responses
 * recorded on Base (2026-09-30): a same-chain transfer and a Relay route to
 * Arbitrum. Addresses are replaced with the test account and the deadline is
 * re-based on the current time; everything else is as the API returned it.
 */

import { type Address, type Hex, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildSweepIntentTypedData } from '../../src/utils/signature.js';
import { buildGasZipDepositCalldata } from '../../src/utils/bridge-targets.js';
import type { AuthorizationResponse, QuoteResponse } from '../../src/types.js';

// Deterministic throwaway key. Never funded, never used anywhere else.
export const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
export const account = privateKeyToAccount(TEST_KEY);

export const ZERODUST = '0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2' as Address;
export const ZERO = '0x0000000000000000000000000000000000000000' as Address;
export const EMPTY_ROUTE = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470' as Hex;
export const RELAY_DEPOSITORY = '0x4cd00e387622c35bddb9b4c962c136462338bc31' as Address;
export const GASZIP_FORWARDER = '0x2a37D63EAdFe4b4682a3c28C1c2cD4F109Cc2762' as Address;
export const ACROSS_PERIPHERY = '0x97ccdbea4632140639ad5ea9b944aa034eb15fd4' as Address;
export const ATTACKER = '0xbadbadbadbadbadbadbadbadbadbadbadbadbad0' as Address;
export const QUOTE_ID = '3f7c1a2e-8b4d-4f6a-9c2e-1d5b7a3e9f04';

/** Base, as recorded: balance, gas price (eth_gasPrice) */
export const BASE_BALANCE = 532742721152083939n;
export const BASE_GAS_PRICE = 6_000_000n;

/** Gas.zip short IDs (from https://backend.gas.zip/v2/chains) */
export const GASZIP_SHORTS: Record<number, number> = { 1: 255, 10: 55, 56: 14, 137: 17, 8453: 54, 42161: 57 };

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export type Route = 'transfer' | 'relay' | 'gaszip';

/** A quote as the API returns it, for the test account */
export function makeQuote(opts: {
  fromChainId?: number;
  toChainId?: number;
  route?: Route;
  destination?: Address;
  user?: Address;
} = {}): QuoteResponse {
  const route = opts.route ?? 'transfer';
  const fromChainId = opts.fromChainId ?? 8453;
  const toChainId = opts.toChainId ?? (route === 'transfer' ? fromChainId : 42161);
  const destination = (opts.destination ?? opts.user ?? account.address).toLowerCase() as Address;

  if (route === 'transfer') {
    return {
      quoteId: QUOTE_ID,
      version: 3,
      userBalance: BASE_BALANCE.toString(),
      estimatedReceive: '532554719945600107',
      mode: 0,
      fees: {
        overheadGasUnits: '110000',
        protocolFeeGasUnits: '0',
        extraFeeWei: '186741206483832',
        reimbGasPriceCapWei: '7200000',
        maxTotalFeeWei: '188001206483832',
        revokeGasUnits: '50000',
      },
      autoRevoke: true,
      intent: {
        mode: 0,
        destination,
        destinationChainId: String(toChainId),
        callTarget: ZERO,
        routeHash: EMPTY_ROUTE,
        minReceive: '532554719945600107',
      },
      deadline: nowSeconds() + 55,
      nonce: 0,
      authNonce: 7,
      validForSeconds: 55,
    };
  }

  const callTarget = route === 'relay' ? RELAY_DEPOSITORY : GASZIP_FORWARDER;
  const routeHash =
    route === 'relay'
      ? ('0xaa06bfdcca59d50f8d38c5a0cb67f2741c49ecdf1bf80b495785cb86490c6932' as Hex)
      : keccak256(buildGasZipDepositCalldata(GASZIP_SHORTS[toChainId]!, destination));

  return {
    quoteId: QUOTE_ID,
    version: 3,
    userBalance: BASE_BALANCE.toString(),
    estimatedReceive: '529832916922592715',
    mode: 1,
    fees: {
      overheadGasUnits: '200000',
      protocolFeeGasUnits: '0',
      extraFeeWei: '186751530448240',
      reimbGasPriceCapWei: '7200000',
      maxTotalFeeWei: '188661272848240',
      revokeGasUnits: '50000',
    },
    autoRevoke: true,
    intent: {
      mode: 1,
      destination,
      destinationChainId: String(toChainId),
      callTarget,
      routeHash,
      minReceive: '503341271076463079',
    },
    deadline: nowSeconds() + 55,
    nonce: 0,
    authNonce: 7,
    validForSeconds: 55,
  };
}

/** The API's POST /authorization response for a quote (the backend's own builder) */
export function makeAuthorization(
  quote: QuoteResponse,
  fromChainId: number,
  user: Address = account.address
): AuthorizationResponse {
  const typedData = buildSweepIntentTypedData(fromChainId, user, {
    mode: quote.intent.mode,
    user,
    destination: quote.intent.destination,
    destinationChainId: BigInt(quote.intent.destinationChainId),
    callTarget: quote.intent.callTarget,
    routeHash: quote.intent.routeHash,
    minReceive: BigInt(quote.intent.minReceive),
    maxTotalFeeWei: BigInt(quote.fees.maxTotalFeeWei),
    overheadGasUnits: BigInt(quote.fees.overheadGasUnits),
    protocolFeeGasUnits: BigInt(quote.fees.protocolFeeGasUnits),
    extraFeeWei: BigInt(quote.fees.extraFeeWei),
    reimbGasPriceCapWei: BigInt(quote.fees.reimbGasPriceCapWei),
    deadline: BigInt(quote.deadline),
    nonce: BigInt(quote.nonce),
  });
  return {
    sweepType: quote.mode === 0 ? 'same-chain' : 'cross-chain',
    typedData,
    contractAddress: ZERODUST,
    version: 3,
  };
}

/** Answers the JSON-RPC calls a sweep makes */
export function rpcResult(
  method: string,
  chain: { nonce: number; balance?: bigint; gasPrice?: bigint; chainId?: number }
): string {
  switch (method) {
    case 'eth_getTransactionCount':
      return `0x${chain.nonce.toString(16)}`;
    case 'eth_getBalance':
      return `0x${(chain.balance ?? BASE_BALANCE).toString(16)}`;
    case 'eth_gasPrice':
      return `0x${(chain.gasPrice ?? BASE_GAS_PRICE).toString(16)}`;
    case 'eth_chainId':
      return `0x${(chain.chainId ?? 8453).toString(16)}`;
    default:
      throw new Error(`unexpected RPC method ${method}`);
  }
}

export function json(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(data),
  } as Response);
}

/** Answers a (possibly batched) JSON-RPC request body */
export function rpcResponse(body: string, chain: Parameters<typeof rpcResult>[1]) {
  const parsed = JSON.parse(body) as { id: number; method: string } | Array<{ id: number; method: string }>;
  const answer = (r: { id: number; method: string }) => ({ jsonrpc: '2.0', id: r.id, result: rpcResult(r.method, chain) });
  return json(Array.isArray(parsed) ? parsed.map(answer) : answer(parsed));
}

/** Gas.zip's GET /v2/chains */
export function gasZipChains() {
  return json({ chains: Object.entries(GASZIP_SHORTS).map(([chain, short]) => ({ chain: Number(chain), short })) });
}

export function isSweepPost(input: unknown, init: unknown): boolean {
  const url = typeof input === 'string' ? input : String(input);
  return (init as RequestInit | undefined)?.method === 'POST' && /\/sweep$/.test(url.split('?')[0] ?? '');
}
