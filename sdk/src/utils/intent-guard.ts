/**
 * @fileoverview Local checks before anything is signed
 *
 * A sweep signs away the whole balance, so the SDK treats the ZeroDust API as
 * untrusted input. The EIP-712 SweepIntent is built here, from hardcoded
 * domain and types and from quote fields that are each checked against what
 * the caller asked for and against chain state read from the caller's own RPC.
 * The typed data the API returns is only compared, never signed.
 *
 * What is enforced:
 * - The delegation target is the ZeroDust contract; the revoke targets address(0).
 * - Domain: name "ZeroDust", version "3", chainId = source chain,
 *   verifyingContract = the signer (the contract runs as the user's EOA).
 * - user = signer, destination = requested destination, destinationChainId =
 *   requested destination chain.
 * - Same-chain: mode 0 (transfer), no call target, empty route.
 * - Cross-chain: mode 1, call target in the per-chain bridge allowlist
 *   (bridge-targets.ts). For Gas.zip the route calldata is rebuilt locally and
 *   must hash to the signed routeHash, which binds the recipient and the
 *   destination chain. When the API supplies the route calldata, its hash must
 *   match and Across/Relay deposits are decoded where the format is known.
 * - Fees, deadline and gas price cap within the bounds below.
 */

import {
  decodeFunctionResult,
  encodeFunctionData,
  type Address,
  type Hex,
  decodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
} from 'viem';
import { ZeroDustError } from '../errors.js';
import type { AuthorizationResponse, EIP7702Authorization, QuoteResponse } from '../types.js';
import {
  DOMAIN_NAME,
  DOMAIN_VERSION,
  MODE_CALL,
  MODE_TRANSFER,
  SWEEP_INTENT_TYPES,
  ZERO_ADDRESS,
  ZERO_ROUTE_HASH,
  ZERODUST_CONTRACT_ADDRESS,
} from './signature.js';
import { type BridgeName, ENDURANCE_ROUTE, HYPERLANE_ROUTES, STARGATE_NATIVE_POOLS, STARGATE_REFUND_ADDRESS, bridgeForCallTarget, buildGasZipDepositCalldata } from './bridge-targets.js';

// ============ Bounds ============

/** The contract's MAX_DEADLINE_WINDOW_SECS */
export const MAX_DEADLINE_WINDOW_SECS = 60;

/** Allowance for the local clock running behind the API's */
export const DEADLINE_CLOCK_SKEW_SECS = 10;

/** reimbGasPriceCapWei may be at most this multiple of the locally read gas price */
export const MAX_GAS_PRICE_CAP_MULTIPLIER = 3n;

/** Floor for the gas price cap limit, for chains whose gas price reads as ~0 */
export const MIN_GAS_PRICE_CAP_LIMIT_WEI = 1_000_000n;

/** The deployed contract's MAX_OVERHEAD_GAS_UNITS */
export const MAX_OVERHEAD_GAS_UNITS = 300_000n;

/** The deployed contract's MAX_PROTOCOL_FEE_GAS_UNITS */
export const MAX_PROTOCOL_FEE_GAS_UNITS = 100_000n;

/**
 * Gas units the fee reserve may pay for, priced at the signed gas price cap.
 * Covers the contract's maximum overhead (300k), the measured routing call
 * (live quotes: 15k for a transfer or Gas.zip, ~80k Across, up to a few
 * hundred k for a Relay route that swaps first), the 50k revoke and a rollup's
 * L1 data fee (live quotes: ~11k units' worth on Unichain). Live quotes on
 * 2026-09-30 used 175k-430k.
 */
export const FEE_GAS_BUDGET_UNITS = 1_500_000n;

/**
 * Service fee ceiling as basis points of the balance. The published fee is 5%
 * under $1 and 1% (max $0.50) above, so 5% always covers it.
 */
export const MAX_SERVICE_FEE_BPS = 500n;

/**
 * Chains that charge extra intrinsic gas per EIP-7702 authorization, which the
 * backend reimburses through extraFeeWei (sweep + revoke). Somnia: 3.4M each.
 */
const CHAIN_EXTRA_GAS_UNITS: Readonly<Record<number, bigint>> = {
  5031: 6_800_000n,
};

/**
 * The largest fee reserve the SDK will sign:
 *   (FEE_GAS_BUDGET_UNITS + chain surcharge units) * reimbGasPriceCapWei
 *   + balance * MAX_SERVICE_FEE_BPS / 10_000
 *   + l1FeeWei (rollups: the L1 data fee allowance from the chain's oracle, see l1-fee.ts)
 *
 * The reserve is paid to the ZeroDust sponsor (the contract only reimburses an
 * allowlisted sponsor), so this bound protects against a grossly wrong or
 * inflated quote, not against a third party redirecting funds; the route and
 * destination checks do that.
 */
export function maxAcceptableFeeWei(p: {
  chainId: number;
  balanceWei: bigint;
  reimbGasPriceCapWei: bigint;
  l1FeeWei?: bigint | undefined;
}): bigint {
  const units = FEE_GAS_BUDGET_UNITS + (CHAIN_EXTRA_GAS_UNITS[p.chainId] ?? 0n);
  return units * p.reimbGasPriceCapWei + (p.balanceWei * MAX_SERVICE_FEE_BPS) / 10_000n + (p.l1FeeWei ?? 0n);
}

// ============ Types ============

/** SweepIntent message as signed (matches the contract struct) */
export interface SweepIntentMessage {
  mode: number;
  user: Address;
  destination: Address;
  destinationChainId: bigint;
  callTarget: Address;
  routeHash: Hex;
  minReceive: bigint;
  maxTotalFeeWei: bigint;
  overheadGasUnits: bigint;
  protocolFeeGasUnits: bigint;
  extraFeeWei: bigint;
  reimbGasPriceCapWei: bigint;
  deadline: bigint;
  nonce: bigint;
}

/** EIP-712 typed data built locally, ready for viem's signTypedData */
export interface SweepTypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
  };
  types: { SweepIntent: Array<{ name: string; type: string }> };
  primaryType: 'SweepIntent';
  message: SweepIntentMessage;
}

/** What the caller asked for, and chain state read from the caller's own RPC */
export interface QuoteCheckContext {
  /** The signing account */
  signer: Address;
  fromChainId: number;
  toChainId: number;
  /** Requested destination */
  destination: Address;
  /** Balance on the source chain, read locally (not the quote's userBalance) */
  balanceWei: bigint;
  /** Gas price on the source chain, read locally */
  gasPriceWei: bigint;
  /** Current unix time in seconds */
  nowSeconds: number;
  /** Rollups: L1 data fee allowance read locally from the chain's oracle (l1FeeAllowanceWei) */
  l1FeeWei?: bigint;
  /**
   * Refuse cross-chain routes whose recipient cannot be verified locally
   * (Relay always; Across unless the API supplies the route calldata).
   */
  requireVerifiedRoute?: boolean;
  /**
   * A Relay deposit the caller fetched from Relay itself (requestRelayDeposit): a Relay route must be
   * exactly this calldata, and its recipient then counts as verified. ZeroDustAgent always sets it.
   */
  ownRelayCallData?: Hex;
  /** Chain ID to Gas.zip short ID, from Gas.zip itself. Needed for Gas.zip routes. */
  resolveGasZipChainShort?: (chainId: number) => Promise<number | undefined>;
  /**
   * eth_call on the source chain. Needed for Stargate routes: the LayerZero fee is read from the
   * pool itself, so a quote cannot pass off more of the value as fee (refunded to ZeroDust).
   */
  ethCall?: (request: { to: Address; data: Hex }) => Promise<Hex | undefined>;
}

export interface VerifiedSweep {
  typedData: SweepTypedData;
  route: {
    /** null for a same-chain transfer */
    bridge: BridgeName | null;
    /** Whether the bridge recipient was checked against the destination */
    recipientVerified: boolean;
  };
}

// ============ Helpers ============

function unsafe(reason: string, details?: Record<string, unknown>): never {
  throw new ZeroDustError('UNSAFE_QUOTE', `Refusing to sign: ${reason}`, details);
}

function toUint(value: unknown, field: string): bigint {
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  return unsafe(`quote field ${field} is not an unsigned integer`, { field, value: String(value) });
}

function toAddr(value: unknown, field: string): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) {
    return unsafe(`quote field ${field} is not an address`, { field, value: String(value) });
  }
  return getAddress(value);
}

function toBytes32(value: unknown, field: string): Hex {
  if (typeof value !== 'string' || !isHex(value) || value.length !== 66) {
    return unsafe(`quote field ${field} is not bytes32`, { field, value: String(value) });
  }
  return value.toLowerCase() as Hex;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function addressToBytes32(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}` as Hex;
}

function assertChainId(chainId: number, label: string): void {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    unsafe(`${label} ${chainId} is not a valid chain ID`);
  }
}

// ============ Route calldata decoding ============

const ACROSS_ABI = parseAbi([
  'function depositNative(address spokePool, address depositor, bytes32 recipient, address inputToken, uint256 inputAmount, bytes32 outputToken, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message)',
  'struct Fees { uint256 amount; address recipient; }',
  'struct BaseDepositData { address inputToken; bytes32 outputToken; uint256 outputAmount; address depositor; bytes32 recipient; uint256 destinationChainId; bytes32 exclusiveRelayer; uint32 quoteTimestamp; uint32 fillDeadline; uint32 exclusivityParameter; bytes message; }',
  'struct SwapAndDepositData { Fees submissionFees; BaseDepositData depositData; address swapToken; address exchange; uint8 transferType; uint256 swapTokenAmount; uint256 minExpectedInputTokenAmount; bytes routerCalldata; bool enableProportionalAdjustment; address spokePool; uint256 nonce; }',
  'function swapAndBridge(SwapAndDepositData swapAndDepositData)',
]);

const RELAY_DEPOSITORY_ABI = parseAbi(['function depositNative(address depositor, bytes32 id)']);

const ENDURANCE_ABI = parseAbi(['function requestFromUser(uint256 nonce_, uint256 amount_) payable']);

/**
 * An Endurance bridge request (token delivery) pays only the sender, so the
 * requested destination must be the signer and the chain BNB Chain.
 * @returns the bridged amount, checked against the routed value once fees are known
 */
function verifyEnduranceCalldata(callData: Hex | undefined, ctx: QuoteCheckContext): bigint {
  if (ctx.fromChainId !== ENDURANCE_ROUTE.chainId || ctx.toChainId !== ENDURANCE_ROUTE.toChainId) {
    return unsafe(`no Endurance route from chain ${ctx.fromChainId} to ${ctx.toChainId}`);
  }
  if (!sameAddress(ctx.destination, ctx.signer)) {
    unsafe('the Endurance bridge only delivers to the sending wallet; the destination must be the signer');
  }
  if (!callData) return unsafe('Endurance route has no calldata to check');
  let amount: bigint;
  try {
    [, amount] = decodeFunctionData({ abi: ENDURANCE_ABI, data: callData }).args;
  } catch {
    return unsafe('Endurance route calldata is not a requestFromUser call');
  }
  if (amount === 0n) unsafe('Endurance request bridges nothing');
  return amount;
}

const HYPERLANE_ABI = parseAbi(['function transferRemote(uint32 destination, bytes32 recipient, uint256 amount) payable returns (bytes32)']);

/**
 * A Hyperlane warp-route transfer (token delivery) must go to the pinned
 * destination domain and pay the requested address there.
 * @returns the bridged amount, checked against the routed value once fees are known
 */
function verifyHyperlaneCalldata(callData: Hex | undefined, ctx: QuoteCheckContext): bigint {
  const route = HYPERLANE_ROUTES[ctx.fromChainId];
  if (!route || route.toChainId !== ctx.toChainId) {
    return unsafe(`no Hyperlane route from chain ${ctx.fromChainId} to ${ctx.toChainId}`);
  }
  if (!callData) return unsafe('Hyperlane route has no calldata to check');
  let args: readonly [number, Hex, bigint];
  try {
    const decoded = decodeFunctionData({ abi: HYPERLANE_ABI, data: callData });
    args = decoded.args;
  } catch {
    return unsafe('Hyperlane route calldata is not a transferRemote call');
  }
  const [domain, recipient, amount] = args;
  if (domain !== route.destinationDomain) unsafe(`Hyperlane transfer goes to domain ${domain}, not ${route.destinationDomain}`);
  if (recipient.toLowerCase() !== addressToBytes32(ctx.destination)) {
    unsafe(`Hyperlane transfer pays ${recipient}, not ${ctx.destination}`);
  }
  if (amount === 0n) unsafe('Hyperlane transfer bridges nothing');
  return amount;
}

const STARGATE_SEND_PARAM = '(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd)';
const STARGATE_ABI = parseAbi([
  `function send(${STARGATE_SEND_PARAM} sendParam, (uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) payable`,
  `function quoteSend(${STARGATE_SEND_PARAM} sendParam, bool payInLzToken) view returns ((uint256 nativeFee, uint256 lzTokenFee) fee)`,
]);
/** The planner's margin on the LayerZero fee (refunded to ZeroDust beyond the real fee), plus rounding to 6 shared decimals */
const STARGATE_FEE_MARGIN_PERCENT = 105n;
const STARGATE_CONVERT_RATE = 10n ** 12n;

/**
 * A Stargate native-pool send: to the destination's pool id, paying the requested address, in
 * taxi mode with nothing run on arrival, the fee refund to ZeroDust (never the wallet: it would
 * break exact zero), and a minimum delivery set. The LayerZero fee is then read from the pool.
 * @returns the bridged amount and the most the rest of the routed value may be (fee + margin)
 */
async function verifyStargateCalldata(callData: Hex | undefined, ctx: QuoteCheckContext): Promise<{ amount: bigint; maxFee: bigint }> {
  const from = STARGATE_NATIVE_POOLS[ctx.fromChainId];
  const to = STARGATE_NATIVE_POOLS[ctx.toChainId];
  if (!from || !to || ctx.fromChainId === ctx.toChainId) return unsafe(`no Stargate route from chain ${ctx.fromChainId} to ${ctx.toChainId}`);
  if (!callData) return unsafe('Stargate route has no calldata to check');
  let param: { dstEid: number; to: Hex; amountLD: bigint; minAmountLD: bigint; extraOptions: Hex; composeMsg: Hex; oftCmd: Hex };
  let fee: { nativeFee: bigint; lzTokenFee: bigint };
  let refund: Address;
  try {
    const decoded = decodeFunctionData({ abi: STARGATE_ABI, data: callData });
    if (decoded.functionName !== 'send') return unsafe('Stargate route is not a send call');
    [param, fee, refund] = decoded.args as unknown as [typeof param, typeof fee, Address];
  } catch {
    return unsafe('Stargate route calldata is not a send call');
  }
  if (param.dstEid !== to.eid) unsafe(`Stargate send goes to endpoint ${param.dstEid}, not chain ${ctx.toChainId}'s ${to.eid}`);
  if (param.to.toLowerCase() !== addressToBytes32(ctx.destination)) unsafe(`Stargate send pays ${param.to}, not ${ctx.destination}`);
  if (refund.toLowerCase() !== STARGATE_REFUND_ADDRESS.toLowerCase()) unsafe(`Stargate fee refund goes to ${refund}, not ZeroDust`);
  if (param.extraOptions !== '0x' || param.composeMsg !== '0x' || param.oftCmd !== '0x') unsafe('Stargate send runs something on arrival or is not a taxi send');
  if (fee.lzTokenFee !== 0n) unsafe('Stargate send pays in ZRO');
  if (param.amountLD === 0n) unsafe('Stargate send bridges nothing');
  if (param.minAmountLD === 0n || param.minAmountLD > param.amountLD) unsafe('Stargate send has no minimum delivery');
  if (!ctx.ethCall) return unsafe('cannot read the Stargate fee on the source chain');
  const out = await ctx.ethCall({ to: from.pool, data: encodeFunctionData({ abi: STARGATE_ABI, functionName: 'quoteSend', args: [param, false] }) });
  if (!out || out === '0x') return unsafe('the Stargate pool did not quote its fee');
  const { nativeFee } = decodeFunctionResult({ abi: STARGATE_ABI, functionName: 'quoteSend', data: out });
  return { amount: param.amountLD, maxFee: (nativeFee * STARGATE_FEE_MARGIN_PERCENT) / 100n + STARGATE_CONVERT_RATE };
}

/**
 * Checks an Across deposit: ZeroDust uses Across only for ETH to ETH as a plain depositNative
 * (no source swap, no destination message), because Across settles a failed or partial swap in
 * USDC/USDT/WETH instead of native gas. The recipient must be the destination.
 * @returns true (the recipient is checked)
 */
function verifyAcrossCalldata(callData: Hex, ctx: QuoteCheckContext): boolean {
  let deposit: { depositor: Address; recipient: Hex; destinationChainId: bigint; message: Hex };
  try {
    const decoded = decodeFunctionData({ abi: ACROSS_ABI, data: callData });
    if (decoded.functionName !== 'depositNative') {
      return unsafe('Across route swaps on the source; only plain ETH deposits deliver native gas');
    }
    const [, depositor, recipient, , , , , destinationChainId, , , , , message] = decoded.args;
    deposit = { depositor, recipient, destinationChainId, message };
  } catch {
    return unsafe('Across route calldata is not a known deposit call');
  }

  if (!sameAddress(deposit.depositor, ctx.signer)) {
    unsafe(`Across deposit refunds to ${deposit.depositor}, not the signer`);
  }
  if (deposit.destinationChainId !== BigInt(ctx.toChainId)) {
    unsafe(`Across deposit goes to chain ${deposit.destinationChainId}, not ${ctx.toChainId}`);
  }
  if (deposit.message !== '0x') {
    unsafe('Across route runs a destination message (a swap); only plain ETH deposits deliver native gas');
  }
  if (deposit.recipient.toLowerCase() !== addressToBytes32(ctx.destination)) {
    unsafe(`Across deposit pays ${deposit.recipient}, not ${ctx.destination}`);
  }
  return true;
}

/** A Relay depository deposit must credit the signer (refunds go there) */
function verifyRelayCalldata(callData: Hex, ctx: QuoteCheckContext): void {
  if (!callData.startsWith('0x49290c1c')) return; // router multicall: nothing decodable to check
  let depositor: Address;
  try {
    [depositor] = decodeFunctionData({ abi: RELAY_DEPOSITORY_ABI, data: callData }).args;
  } catch {
    return unsafe('Relay route calldata is malformed');
  }
  if (!sameAddress(depositor, ctx.signer)) {
    unsafe(`Relay deposit credits ${depositor}, not the signer`);
  }
}

// ============ Quote verification ============

/**
 * Verifies a quote against the request and local chain state, and builds the
 * EIP-712 typed data to sign from it. Throws ZeroDustError('UNSAFE_QUOTE')
 * on any mismatch; nothing should be signed in that case.
 */
export async function verifySweepQuote(
  quote: QuoteResponse,
  ctx: QuoteCheckContext
): Promise<VerifiedSweep> {
  assertChainId(ctx.fromChainId, 'Source chain');
  assertChainId(ctx.toChainId, 'Destination chain');

  const intent = quote?.intent as (QuoteResponse['intent'] & { callData?: unknown }) | undefined;
  const fees = quote?.fees;
  if (!intent || typeof intent !== 'object' || !fees || typeof fees !== 'object') {
    unsafe('quote has no intent or fee fields');
  }

  const signer = getAddress(ctx.signer);
  const requested = getAddress(ctx.destination);

  // ---- Destination ----
  const destination = toAddr(intent.destination, 'intent.destination');
  if (destination !== requested) {
    unsafe(`quote destination ${destination} is not the requested ${requested}`);
  }
  if (destination === ZERO_ADDRESS) unsafe('destination is the zero address');

  const destinationChainId = toUint(intent.destinationChainId, 'intent.destinationChainId');
  if (destinationChainId !== BigInt(ctx.toChainId)) {
    unsafe(`quote destination chain ${destinationChainId} is not the requested ${ctx.toChainId}`);
  }

  // ---- Mode and route ----
  const mode = Number(toUint(intent.mode, 'intent.mode'));
  if (quote.mode !== undefined && Number(quote.mode) !== mode) {
    unsafe(`quote mode ${quote.mode} disagrees with intent mode ${mode}`);
  }
  const callTarget = toAddr(intent.callTarget, 'intent.callTarget');
  const routeHash = toBytes32(intent.routeHash, 'intent.routeHash');

  let bridge: BridgeName | null = null;
  let recipientVerified = false;
  /** Hyperlane: the amount the transfer bridges; it must fit in the routed value */
  let bridgedAmount: bigint | null = null;
  /** Stargate: the most of the routed value that may go to the LayerZero fee (read on-chain) */
  let bridgeMaxFee: bigint | null = null;

  if (ctx.fromChainId === ctx.toChainId) {
    if (mode !== MODE_TRANSFER) unsafe(`same-chain sweep must be a transfer (mode 0), got mode ${mode}`);
    if (callTarget !== ZERO_ADDRESS) unsafe(`same-chain sweep has a call target ${callTarget}`);
    if (routeHash !== ZERO_ROUTE_HASH.toLowerCase()) unsafe('same-chain sweep has a non-empty route');
    recipientVerified = true;
  } else {
    if (mode !== MODE_CALL) unsafe(`cross-chain sweep must be a bridge call (mode 1), got mode ${mode}`);

    bridge = bridgeForCallTarget(ctx.fromChainId, callTarget);
    if (!bridge) {
      unsafe(`call target ${callTarget} is not a known bridge contract on chain ${ctx.fromChainId}`, {
        callTarget,
        chainId: ctx.fromChainId,
      });
    }

    let callData: Hex | undefined;
    if (intent.callData !== undefined && intent.callData !== null) {
      if (typeof intent.callData !== 'string' || !isHex(intent.callData)) {
        unsafe('quote route calldata is not hex');
      }
      callData = intent.callData.toLowerCase() as Hex;
      if (keccak256(callData) !== routeHash) unsafe('routeHash is not keccak256 of the route calldata');
    }

    if (bridge === 'gaszip') {
      // Rebuild the forwarder calldata from Gas.zip's own chain map: the hash
      // then binds both the recipient and the destination chain.
      const short = ctx.resolveGasZipChainShort
        ? await ctx.resolveGasZipChainShort(ctx.toChainId)
        : undefined;
      if (short === undefined) unsafe(`cannot verify the Gas.zip route to chain ${ctx.toChainId}`);
      const expected = buildGasZipDepositCalldata(short, requested);
      if (keccak256(expected) !== routeHash) {
        unsafe(`Gas.zip route does not deposit to ${requested} on chain ${ctx.toChainId}`);
      }
      recipientVerified = true;
    } else if (bridge === 'hyperlane') {
      bridgedAmount = verifyHyperlaneCalldata(callData, { ...ctx, signer, destination: requested });
      recipientVerified = true;
    } else if (bridge === 'stargate') {
      const checked = await verifyStargateCalldata(callData, { ...ctx, signer, destination: requested });
      bridgedAmount = checked.amount;
      bridgeMaxFee = checked.maxFee;
      recipientVerified = true;
    } else if (bridge === 'endurance') {
      bridgedAmount = verifyEnduranceCalldata(callData, { ...ctx, signer, destination: requested });
      recipientVerified = true;
    } else if (bridge === 'across') {
      recipientVerified = callData ? verifyAcrossCalldata(callData, { ...ctx, signer, destination: requested }) : false;
    } else if (bridge === 'relay') {
      if (callData) verifyRelayCalldata(callData, { ...ctx, signer });
      if (ctx.ownRelayCallData !== undefined) {
        if (!callData || callData !== ctx.ownRelayCallData.toLowerCase()) {
          unsafe('the Relay route is not the deposit fetched from Relay');
        }
        recipientVerified = true;
      }
    }

    if (ctx.requireVerifiedRoute && !recipientVerified) {
      unsafe(`the ${bridge} route's recipient cannot be verified locally (requireVerifiedRoute is set)`);
    }
  }

  // ---- Fees ----
  const maxTotalFeeWei = toUint(fees.maxTotalFeeWei, 'fees.maxTotalFeeWei');
  const overheadGasUnits = toUint(fees.overheadGasUnits, 'fees.overheadGasUnits');
  const protocolFeeGasUnits = toUint(fees.protocolFeeGasUnits, 'fees.protocolFeeGasUnits');
  const extraFeeWei = toUint(fees.extraFeeWei, 'fees.extraFeeWei');
  const reimbGasPriceCapWei = toUint(fees.reimbGasPriceCapWei, 'fees.reimbGasPriceCapWei');
  const minReceive = toUint(intent.minReceive, 'intent.minReceive');

  if (overheadGasUnits > MAX_OVERHEAD_GAS_UNITS) unsafe(`overheadGasUnits ${overheadGasUnits} is above ${MAX_OVERHEAD_GAS_UNITS}`);
  if (protocolFeeGasUnits > MAX_PROTOCOL_FEE_GAS_UNITS) {
    unsafe(`protocolFeeGasUnits ${protocolFeeGasUnits} is above ${MAX_PROTOCOL_FEE_GAS_UNITS}`);
  }

  let capLimit = ctx.gasPriceWei * MAX_GAS_PRICE_CAP_MULTIPLIER;
  if (capLimit < MIN_GAS_PRICE_CAP_LIMIT_WEI) capLimit = MIN_GAS_PRICE_CAP_LIMIT_WEI;
  if (reimbGasPriceCapWei === 0n || reimbGasPriceCapWei > capLimit) {
    unsafe(
      `gas price cap ${reimbGasPriceCapWei} wei is not within ${MAX_GAS_PRICE_CAP_MULTIPLIER}x the current ${ctx.gasPriceWei} wei`
    );
  }

  if (extraFeeWei > maxTotalFeeWei) unsafe('extraFeeWei exceeds maxTotalFeeWei');
  if (maxTotalFeeWei >= ctx.balanceWei) {
    unsafe(`fee reserve ${maxTotalFeeWei} wei would take the whole balance of ${ctx.balanceWei} wei`);
  }
  // The contract routes balance - reserve; a token-delivery bridge takes that minus its own fee
  if (bridgedAmount !== null && bridgedAmount >= ctx.balanceWei - maxTotalFeeWei) {
    unsafe(`${bridge} transfer of ${bridgedAmount} wei does not fit in the ${ctx.balanceWei - maxTotalFeeWei} wei routed`);
  }
  if (bridgedAmount !== null && bridgeMaxFee !== null && ctx.balanceWei - maxTotalFeeWei - bridgedAmount > bridgeMaxFee) {
    unsafe(`${bridge} would keep ${ctx.balanceWei - maxTotalFeeWei - bridgedAmount} wei as its fee, above the ${bridgeMaxFee} wei it quotes`);
  }
  const feeLimit = maxAcceptableFeeWei({
    chainId: ctx.fromChainId,
    balanceWei: ctx.balanceWei,
    reimbGasPriceCapWei,
    l1FeeWei: ctx.l1FeeWei,
  });
  if (maxTotalFeeWei > feeLimit) {
    unsafe(`fee reserve ${maxTotalFeeWei} wei exceeds the ${feeLimit} wei limit`, {
      maxTotalFeeWei: maxTotalFeeWei.toString(),
      limit: feeLimit.toString(),
    });
  }

  // ---- Deadline ----
  const deadline = toUint(quote.deadline, 'deadline');
  const now = BigInt(Math.floor(ctx.nowSeconds));
  if (deadline <= now) unsafe('quote deadline has passed');
  if (deadline > now + BigInt(MAX_DEADLINE_WINDOW_SECS + DEADLINE_CLOCK_SKEW_SECS)) {
    unsafe(`quote deadline is ${deadline - now}s away, more than ${MAX_DEADLINE_WINDOW_SECS}s`);
  }

  const nonce = toUint(quote.nonce, 'nonce');

  return {
    typedData: {
      domain: {
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        chainId: ctx.fromChainId,
        verifyingContract: signer,
      },
      types: { SweepIntent: SWEEP_INTENT_TYPES.SweepIntent.map((f) => ({ ...f })) },
      primaryType: 'SweepIntent',
      message: {
        mode,
        user: signer,
        destination,
        destinationChainId,
        callTarget,
        routeHash,
        minReceive,
        maxTotalFeeWei,
        overheadGasUnits,
        protocolFeeGasUnits,
        extraFeeWei,
        reimbGasPriceCapWei,
        deadline,
        nonce,
      },
    },
    route: { bridge, recipientVerified },
  };
}

// ============ API authorization response ============

/**
 * The API's authorization response must name the ZeroDust contract and
 * describe exactly the intent built locally. It is never signed; a mismatch
 * means the backend would verify a different message, so stop here.
 */
export function assertAuthorizationMatches(auth: AuthorizationResponse, local: SweepTypedData): void {
  if (typeof auth?.contractAddress !== 'string' || !sameAddress(auth.contractAddress, ZERODUST_CONTRACT_ADDRESS)) {
    unsafe(`API asked to delegate to ${String(auth?.contractAddress)}, not the ZeroDust contract ${ZERODUST_CONTRACT_ADDRESS}`);
  }

  const td = auth.typedData;
  if (!td || td.primaryType !== 'SweepIntent') unsafe('API typed data is not a SweepIntent');

  const d = td.domain;
  if (
    d?.name !== local.domain.name ||
    d.version !== local.domain.version ||
    Number(d.chainId) !== local.domain.chainId ||
    typeof d.verifyingContract !== 'string' ||
    !sameAddress(d.verifyingContract, local.domain.verifyingContract)
  ) {
    unsafe('API typed data domain differs from the ZeroDust domain');
  }

  const apiFields = td.types?.SweepIntent;
  const localFields = local.types.SweepIntent;
  if (
    !Array.isArray(apiFields) ||
    apiFields.length !== localFields.length ||
    apiFields.some((f, i) => f?.name !== localFields[i]!.name || f?.type !== localFields[i]!.type)
  ) {
    unsafe('API SweepIntent type differs from the contract');
  }

  const message = td.message ?? {};
  for (const [key, value] of Object.entries(local.message)) {
    const theirs = message[key];
    if (theirs === undefined || String(theirs).toLowerCase() !== String(value).toLowerCase()) {
      unsafe(`API typed data field ${key} differs from the verified quote`);
    }
  }
}

// ============ Signed EIP-7702 authorizations ============

/** Checks a signed EIP-7702 authorization before it leaves the SDK */
export function assertSignedAuthorization(
  auth: EIP7702Authorization,
  expected: { contractAddress: Address; chainId: number; nonce?: number },
  label: string
): void {
  if (!sameAddress(auth.contractAddress, expected.contractAddress)) {
    unsafe(`${label} authorization targets ${auth.contractAddress}, expected ${expected.contractAddress}`);
  }
  if (auth.chainId !== expected.chainId) {
    unsafe(`${label} authorization is for chain ${auth.chainId}, expected ${expected.chainId}`);
  }
  if (expected.nonce !== undefined && auth.nonce !== expected.nonce) {
    unsafe(`${label} authorization nonce is ${auth.nonce}, expected ${expected.nonce}`);
  }
}
