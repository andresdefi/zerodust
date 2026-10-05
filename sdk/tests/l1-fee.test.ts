/**
 * @fileoverview The L1 data fee allowance comes from the rollup's own oracle,
 * never from the quote
 */

import { describe, it, expect } from 'vitest';
import { decodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { l1FeeAllowanceWei, L1_FEE_ALLOWANCE_MULTIPLIER, L1_FEE_PROBE_BYTES } from '../src/utils/l1-fee.js';

const ORACLE_ABI = parseAbi(['function getL1Fee(bytes) view returns (uint256)']);
const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}` as Hex;

function recorder(answers: Record<string, Hex | undefined>) {
  const calls: Array<{ to: Address; data: Hex }> = [];
  const call = async (c: { to: Address; data: Hex }) => {
    calls.push(c);
    return answers[c.data.slice(0, 10)];
  };
  return { calls, call };
}

describe('l1FeeAllowanceWei', () => {
  it('is 0 without an RPC call on a chain with no L1 data fee', async () => {
    const r = recorder({});
    expect(await l1FeeAllowanceWei(42161, r.call)).toBe(0n);
    expect(r.calls).toHaveLength(0);
  });

  it('prices the probe with the OP-stack oracle and doubles it', async () => {
    const r = recorder({ '0x49948e0e': word(1_000n) });
    expect(await l1FeeAllowanceWei(7777777, r.call)).toBe(1_000n * L1_FEE_ALLOWANCE_MULTIPLIER);
    expect(r.calls[0]!.to).toBe('0x420000000000000000000000000000000000000F');
    const { args } = decodeFunctionData({ abi: ORACLE_ABI, data: r.calls[0]!.data });
    expect((args[0].length - 2) / 2).toBe(L1_FEE_PROBE_BYTES);
  });

  it("uses Scroll's own oracle on Scroll", async () => {
    const r = recorder({ '0x49948e0e': word(7n) });
    expect(await l1FeeAllowanceWei(534352, r.call)).toBe(14n);
    expect(r.calls[0]!.to).toBe('0x5300000000000000000000000000000000000002');
  });

  it("converts Mantle's ETH-denominated fee to MNT with tokenRatio()", async () => {
    const r = recorder({ '0x49948e0e': word(3n), '0x06f837d3': word(4_000n) });
    expect(await l1FeeAllowanceWei(5000, r.call)).toBe(3n * 4_000n * L1_FEE_ALLOWANCE_MULTIPLIER);
  });

  it('throws rather than allow 0 when a rollup oracle does not answer', async () => {
    await expect(l1FeeAllowanceWei(534352, recorder({}).call)).rejects.toThrow(/returned nothing/);
  });
});
