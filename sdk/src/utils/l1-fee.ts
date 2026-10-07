/**
 * L1 data fee allowance for the fee ceiling, read from the rollup's own oracle.
 *
 * On OP-stack chains, Scroll and Mantle every tx also pays an L1 data fee,
 * which the backend charges in the fee reserve (extraFeeWei). The gas-unit
 * budget of maxAcceptableFeeWei does not cover it where L2 gas is nearly free
 * and the L1 fee is most of the cost: on 2026-10-05 Scroll's honest reserve was
 * 5.7x that budget and Zora's 1.01x, so the SDK refused both sweeps.
 *
 * The allowance prices L1_FEE_PROBE_BYTES of incompressible bytes, more than a
 * sweep tx (~1.3 KB with 512 bytes of bridge calldata) and its revoke (~0.2 KB)
 * together, and doubles it for L1 price moves. It comes from the chain, not the
 * API, so a wrong quote still cannot raise its own ceiling.
 *
 * Arbitrum Nova charges its L1 cost as gas units of the tx (Nitro's poster fee), priced by the
 * NodeInterface: ~6M units for a sweep tx on 2026-10-07 (Nova's L1 price estimate 8.6 gwei),
 * so the backend charges it in extraFeeWei too. Arbitrum One's is negligible and stays unpriced.
 */

import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toHex, type Address, type Hex } from 'viem';

const OP_GAS_PRICE_ORACLE: Address = '0x420000000000000000000000000000000000000F';
const SCROLL_L1_GAS_ORACLE: Address = '0x5300000000000000000000000000000000000002';
/** Arbitrum Nitro NodeInterface (a virtual contract, eth_call only) */
const ARBITRUM_NODE_INTERFACE: Address = '0x00000000000000000000000000000000000000C8';
const NODE_INTERFACE_ABI = parseAbi([
  'function gasEstimateL1Component(address to, bool contractCreation, bytes data) payable returns (uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)',
]);

type L1FeeOracle = 'op' | 'scroll' | 'mantle' | 'arbitrum';

/**
 * ZeroDust chains whose txs pay an L1 data fee (the backend's list, probed
 * 2026-09-29). Mantle's oracle answers in ETH and the fee is paid in MNT, so it
 * is multiplied by tokenRatio(). Arbitrum Nova charges it as gas units (NodeInterface).
 */
export const L1_FEE_ORACLES: Readonly<Record<number, L1FeeOracle>> = {
  10: 'op', 130: 'op', 169: 'op', 252: 'op', 360: 'op', 480: 'op', 1135: 'op', 1868: 'op',
  2020: 'op', 4326: 'op', 5330: 'op', 8453: 'op', 34443: 'op', 42018: 'op', 43111: 'op',
  48900: 'op', 57073: 'op', 60808: 'op', 97477: 'op', 685689: 'op', 747474: 'op', 7777777: 'op',
  534352: 'scroll',
  5000: 'mantle',
  42170: 'arbitrum',
};

/** Bytes priced: more than a sweep tx and its revoke together, and incompressible */
export const L1_FEE_PROBE_BYTES = 2048;

/** Headroom on the oracle's price for L1 moves between quote and signing */
export const L1_FEE_ALLOWANCE_MULTIPLIER = 2n;

const GET_L1_FEE_SELECTOR = '0x49948e0e'; // getL1Fee(bytes)
const TOKEN_RATIO_SELECTOR = '0x06f837d3'; // tokenRatio()

/** eth_call returning the raw result */
export type RawCall = (request: { to: Address; data: Hex }) => Promise<Hex | undefined>;

function probe(): Hex {
  let out = '';
  for (let i = 0; out.length < L1_FEE_PROBE_BYTES * 2; i++) out += keccak256(toHex(`zerodust-l1-probe:${i}`)).slice(2);
  return `0x${out.slice(0, L1_FEE_PROBE_BYTES * 2)}` as Hex;
}

function encodeGetL1Fee(bytes: Hex): Hex {
  const body = bytes.slice(2);
  const length = (body.length / 2).toString(16).padStart(64, '0');
  const padded = body.padEnd(Math.ceil(body.length / 64) * 64, '0');
  return `${GET_L1_FEE_SELECTOR}${'20'.padStart(64, '0')}${length}${padded}` as Hex;
}

/**
 * The L1 data fee the fee reserve may include on this chain: 0 where there is
 * none. Throws if a chain known to charge one cannot be priced.
 */
export async function l1FeeAllowanceWei(chainId: number, call: RawCall): Promise<bigint> {
  const oracle = L1_FEE_ORACLES[chainId];
  if (!oracle) return 0n;
  if (oracle === 'arbitrum') {
    const answer = await call({
      to: ARBITRUM_NODE_INTERFACE,
      data: encodeFunctionData({ abi: NODE_INTERFACE_ABI, functionName: 'gasEstimateL1Component', args: [ARBITRUM_NODE_INTERFACE, false, probe()] }),
    });
    if (!answer || answer === '0x') throw new Error(`NodeInterface returned nothing on chain ${chainId}`);
    const [gasForL1, baseFee] = decodeFunctionResult({ abi: NODE_INTERFACE_ABI, functionName: 'gasEstimateL1Component', data: answer });
    return gasForL1 * baseFee * L1_FEE_ALLOWANCE_MULTIPLIER;
  }
  const to = oracle === 'scroll' ? SCROLL_L1_GAS_ORACLE : OP_GAS_PRICE_ORACLE;
  const fee = await call({ to, data: encodeGetL1Fee(probe()) });
  if (!fee || fee === '0x') throw new Error(`L1 fee oracle returned nothing on chain ${chainId}`);
  let wei = BigInt(fee);
  if (oracle === 'mantle') {
    const ratio = await call({ to: OP_GAS_PRICE_ORACLE, data: TOKEN_RATIO_SELECTOR });
    if (!ratio || ratio === '0x') throw new Error('Mantle tokenRatio() returned nothing');
    wei *= BigInt(ratio);
  }
  return wei * L1_FEE_ALLOWANCE_MULTIPLIER;
}
