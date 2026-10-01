/**
 * @fileoverview API errors without a code, 429 backoff, and polling through
 * transient errors
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZeroDust } from '../src/client.js';
import { ZeroDustError, codeForStatus, createErrorFromResponse } from '../src/errors.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response);
}

const SWEEP_ID = '3f7c1a2e-8b4d-4f6a-9c2e-1d5b7a3e9f04';
const status = (s: string) => ({ sweepId: SWEEP_ID, status: s, sweepType: 'same-chain', mode: 0, destination: '0x' + '1'.repeat(40), fromChainId: 8453, toChainId: 8453, version: 3, createdAt: '', updatedAt: '' });

beforeEach(() => {
  mockFetch.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('codeForStatus', () => {
  it('maps statuses the API sends without a code', () => {
    expect(codeForStatus(404)).toBe('NOT_FOUND');
    expect(codeForStatus(429)).toBe('RATE_LIMITED');
    expect(codeForStatus(401)).toBe('UNAUTHORIZED');
    expect(codeForStatus(403)).toBe('UNAUTHORIZED');
    expect(codeForStatus(400)).toBe('INVALID_REQUEST');
    expect(codeForStatus(503)).toBe('SERVICE_UNAVAILABLE');
    expect(codeForStatus(500)).toBe('INTERNAL_ERROR');
  });

  it('keeps a code the API did send, and is not retryable for a 404', () => {
    expect(createErrorFromResponse(400, { error: 'x', code: 'QUOTE_EXPIRED' }).code).toBe('QUOTE_EXPIRED');
    const notFound = createErrorFromResponse(404, { error: 'Sweep not found' });
    expect(notFound.code).toBe('NOT_FOUND');
    expect(notFound.isRetryable()).toBe(false);
    const limited = createErrorFromResponse(429, { error: 'Too Many Requests', message: 'Maximum 60 quotes per minute.' });
    expect(limited.code).toBe('RATE_LIMITED');
    expect(limited.message).toBe('Maximum 60 quotes per minute.');
    expect(limited.isRetryable()).toBe(true);
  });
});

describe('HTTP retries', () => {
  it('a 404 fails at once as NOT_FOUND, with no retry', async () => {
    mockFetch.mockReturnValue(json({ error: 'Sweep not found' }, 404));
    const client = new ZeroDust({ environment: 'mainnet', retries: 3 });
    await expect(client.getSweepStatus(SWEEP_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('a 429 is retried after Retry-After, POST included, then succeeds', async () => {
    mockFetch
      .mockReturnValueOnce(json({ error: 'Too Many Requests', message: 'slow down' }, 429, { 'retry-after': '2' }))
      .mockReturnValueOnce(json({ sweepId: SWEEP_ID, status: 'pending', sweepType: 'same-chain' }));
    const client = new ZeroDust({ environment: 'mainnet', retries: 2 });
    const pending = client.submitSweep({ quoteId: SWEEP_ID, signature: '0x' + '1'.repeat(130), eip7702Authorization: { chainId: 8453, contractAddress: '0x' + '2'.repeat(40), nonce: 1, yParity: 0, r: '0x' + '3'.repeat(64), s: '0x' + '4'.repeat(64) }, revokeAuthorization: { chainId: 8453, contractAddress: '0x' + '0'.repeat(40), nonce: 2, yParity: 0, r: '0x' + '3'.repeat(64), s: '0x' + '4'.repeat(64) } } as never);
    await vi.advanceTimersByTimeAsync(1999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ sweepId: SWEEP_ID });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retries with RATE_LIMITED', async () => {
    mockFetch.mockReturnValue(json({ error: 'Too Many Requests', message: 'slow down' }, 429));
    const client = new ZeroDust({ environment: 'mainnet', retries: 1 });
    const result = client.getSweepStatus(SWEEP_ID).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const error = await result;
    expect(error).toBeInstanceOf(ZeroDustError);
    expect((error as ZeroDustError).code).toBe('RATE_LIMITED');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('waitForSweep', () => {
  it('keeps polling through rate limits until the sweep completes', async () => {
    mockFetch
      .mockReturnValueOnce(json(status('executing')))
      .mockReturnValueOnce(json({ error: 'Too Many Requests', message: 'slow down' }, 429))
      .mockReturnValueOnce(json(status('completed')));
    const client = new ZeroDust({ environment: 'mainnet', retries: 0 });
    const done = client.waitForSweep(SWEEP_ID, { intervalMs: 1000, timeoutMs: 60_000 });
    await vi.runAllTimersAsync();
    await expect(done).resolves.toMatchObject({ status: 'completed' });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('stops at once on an error that is not transient', async () => {
    mockFetch.mockReturnValueOnce(json({ error: 'Sweep not found' }, 404));
    const client = new ZeroDust({ environment: 'mainnet', retries: 0 });
    await expect(client.waitForSweep(SWEEP_ID, { intervalMs: 1000, timeoutMs: 60_000 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
