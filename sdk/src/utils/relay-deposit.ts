/**
 * @fileoverview A Relay deposit fetched from Relay itself
 *
 * Relay keeps a request's recipient on its own servers; the deposit calldata only carries an id.
 * A Relay route the ZeroDust API supplies therefore cannot be checked before signing. Instead the
 * client asks Relay for the deposit (the recipient and refund address it sets, exactly the amount
 * the sweep routes), checks Relay's answer, and binds it into the quote with
 * POST /quote/:quoteId/relay-route. Only that deposit is then signed.
 */

import type { Address, Hex } from 'viem';
import { ZeroDustError } from '../errors.js';

export const RELAY_API_URL = 'https://api.relay.link';
const NATIVE = '0x0000000000000000000000000000000000000000';

export interface RelayDepositRequest {
  /** The sweeping wallet (Relay's user and refund address) */
  user: Address;
  /** The address the sweep pays */
  recipient: Address;
  fromChainId: number;
  toChainId: number;
  /** Exactly what the sweep routes into the bridge: the quote's bridge.inputAmount (wei) */
  amount: bigint;
  /** The least Relay may deliver: the quote's estimatedReceive (destination wei) */
  minOut: bigint;
  /** Relay's API base (default https://api.relay.link) */
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface RelayDeposit {
  to: Address;
  data: Hex;
  value: bigint;
  requestId: Hex;
}

interface RelayAnswer {
  requestId?: string;
  message?: string;
  steps?: Array<{ kind?: string; requestId?: string; items: Array<{ data: { to: string; data: string; value: string; chainId: number } }> }>;
  details?: { recipient?: string; currencyOut?: { amount?: string; currency?: { address?: string; chainId?: number } } };
}

function unsafe(reason: string): never {
  throw new ZeroDustError('UNSAFE_QUOTE', `Refusing to sign: ${reason}`);
}

/**
 * Asks Relay for the deposit and checks its answer: one transaction on the source chain for
 * exactly `amount`, paying `recipient` the destination's native gas, at least `minOut`.
 */
export async function requestRelayDeposit(req: RelayDepositRequest): Promise<RelayDeposit> {
  const doFetch = req.fetchImpl ?? fetch;
  let answer: RelayAnswer;
  let ok: boolean;
  try {
    const res = await doFetch(`${(req.apiUrl ?? RELAY_API_URL).replace(/\/$/, '')}/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user: req.user,
        recipient: req.recipient,
        refundTo: req.user,
        originChainId: req.fromChainId,
        destinationChainId: req.toChainId,
        originCurrency: NATIVE,
        destinationCurrency: NATIVE,
        amount: req.amount.toString(),
        tradeType: 'EXACT_INPUT',
      }),
    });
    ok = res.ok;
    answer = (await res.json().catch(() => ({}))) as RelayAnswer;
  } catch (error) {
    throw new ZeroDustError('NETWORK_ERROR', 'Relay did not answer', { cause: error instanceof Error ? error.message : String(error) });
  }
  if (!ok || !Array.isArray(answer.steps)) unsafe(`Relay did not quote this sweep (${answer.message ?? 'no route'})`);

  const steps = answer.steps!.filter((s) => s.items.length > 0);
  if (steps.length !== 1 || steps[0]!.kind !== 'transaction' || steps[0]!.items.length !== 1) unsafe('Relay asked for more than one transaction');
  const tx = steps[0]!.items[0]!.data;
  const requestId = steps[0]!.requestId ?? answer.requestId ?? '';
  if (tx.chainId !== req.fromChainId) unsafe("Relay's deposit is on another chain");
  if (BigInt(tx.value) !== req.amount) unsafe("Relay's deposit is for another amount");
  if (!/^0x[0-9a-fA-F]{40}$/.test(tx.to) || !/^0x[0-9a-fA-F]+$/.test(tx.data)) unsafe("Relay's deposit is malformed");
  if (!/^0x[0-9a-fA-F]{64}$/.test(requestId)) unsafe("Relay's answer has no request id");
  const recipient = answer.details?.recipient;
  if (!recipient || recipient.toLowerCase() !== req.recipient.toLowerCase()) unsafe(`Relay would pay ${recipient ?? 'an unstated recipient'}, not ${req.recipient}`);
  const out = answer.details?.currencyOut;
  if (out?.currency?.address?.toLowerCase() !== NATIVE || out?.currency?.chainId !== req.toChainId) unsafe('Relay would not deliver native gas');
  if (BigInt(out?.amount ?? '0') < req.minOut) unsafe('Relay now quotes less than the amount shown');

  return { to: tx.to as Address, data: tx.data.toLowerCase() as Hex, value: BigInt(tx.value), requestId: requestId as Hex };
}
