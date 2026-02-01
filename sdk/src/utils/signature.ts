/**
 * @fileoverview EIP-712 signature utilities for the ZeroDust SDK
 *
 * This module provides helpers for building EIP-712 typed data
 * that matches the ZeroDust contract's expectations.
 */

import { type Address, type Hex, keccak256, toHex } from 'viem';
import type { EIP712TypedData } from '../types.js';

// ============ Constants ============

/**
 * EIP-712 domain name
 */
export const DOMAIN_NAME = 'ZeroDustSweep';

/**
 * EIP-712 domain version
 */
export const DOMAIN_VERSION = '1';

/**
 * Mode for same-chain sweeps (direct transfer)
 */
export const MODE_TRANSFER = 0;

/**
 * Mode for cross-chain sweeps (via bridge call)
 */
export const MODE_CALL = 1;

/**
 * Zero address constant
 */
export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * Zero route hash (keccak256 of empty bytes)
 */
export const ZERO_ROUTE_HASH: Hex = keccak256(toHex(''));

// ============ SweepIntent Types ============

/**
 * EIP-712 type definition for SweepIntent
 * Matches the contract's SWEEP_INTENT_TYPEHASH
 */
export const SWEEP_INTENT_TYPES = {
  SweepIntent: [
    { name: 'mode', type: 'uint8' },
    { name: 'user', type: 'address' },
    { name: 'destination', type: 'address' },
    { name: 'destinationChainId', type: 'uint256' },
    { name: 'callTarget', type: 'address' },
    { name: 'routeHash', type: 'bytes32' },
    { name: 'minReceive', type: 'uint256' },
    { name: 'maxTotalFeeWei', type: 'uint256' },
    { name: 'overheadGasUnits', type: 'uint256' },
    { name: 'protocolFeeGasUnits', type: 'uint256' },
    { name: 'extraFeeWei', type: 'uint256' },
    { name: 'reimbGasPriceCapWei', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

/**
 * Parameters for building a SweepIntent
 */
export interface SweepIntentParams {
  /** Mode: 0 = transfer (same-chain), 1 = call (cross-chain) */
  mode: number;
  /** User's address */
  user: Address;
  /** Destination address */
  destination: Address;
  /** Destination chain ID */
  destinationChainId: bigint;
  /** Bridge call target (address(0) for MODE_TRANSFER) */
  callTarget: Address;
  /** Route hash (keccak256(callData) for MODE_CALL) */
  routeHash: Hex;
  /** Minimum amount to receive */
  minReceive: bigint;
  /** Maximum total fee in wei */
  maxTotalFeeWei: bigint;
  /** Gas overhead in gas units */
  overheadGasUnits: bigint;
  /** Protocol fee in gas units (deprecated, always 0) */
  protocolFeeGasUnits: bigint;
  /** Extra fee in wei (includes service fee) */
  extraFeeWei: bigint;
  /** Maximum gas price for reimbursement */
  reimbGasPriceCapWei: bigint;
  /** Deadline timestamp (unix seconds) */
  deadline: bigint;
  /** Sweep nonce */
  nonce: bigint;
}

// ============ Functions ============

/**
 * Compute the route hash from callData
 *
 * @param callData - Bridge call data
 * @returns keccak256 hash of the callData
 *
 * @example
 * const hash = computeRouteHash('0x...');
 */
export function computeRouteHash(callData: Hex): Hex {
  return keccak256(callData);
}

/**
 * Build EIP-712 typed data for a SweepIntent
 *
 * This function creates the typed data structure required for
 * EIP-712 signing. The user signs this data to authorize a sweep.
 *
 * IMPORTANT: The verifyingContract is the user's EOA address,
 * not the contract address. This is because EIP-7702 executes
 * the contract code at the user's address.
 *
 * @param chainId - Source chain ID
 * @param userAddress - User's EOA address (used as verifyingContract)
 * @param params - SweepIntent parameters
 * @returns EIP-712 typed data structure
 *
 * @example
 * const typedData = buildSweepIntentTypedData(
 *   8453, // Base
 *   '0x1234...',
 *   {
 *     mode: MODE_TRANSFER,
 *     user: '0x1234...',
 *     destination: '0x5678...',
 *     destinationChainId: 8453n,
 *     callTarget: ZERO_ADDRESS,
 *     routeHash: ZERO_ROUTE_HASH,
 *     minReceive: 900000000000000n,
 *     maxTotalFeeWei: 100000000000000n,
 *     overheadGasUnits: 100000n,
 *     protocolFeeGasUnits: 0n,
 *     extraFeeWei: 50000000000000n,
 *     reimbGasPriceCapWei: 1000000000n,
 *     deadline: 1706745600n,
 *     nonce: 0n,
 *   }
 * );
 */
export function buildSweepIntentTypedData(
  chainId: number,
  userAddress: Address,
  params: SweepIntentParams
): EIP712TypedData {
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      SweepIntent: [...SWEEP_INTENT_TYPES.SweepIntent],
    },
    primaryType: 'SweepIntent',
    domain: {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId,
      verifyingContract: userAddress, // User's EOA, not contract!
    },
    message: {
      mode: params.mode,
      user: params.user,
      destination: params.destination,
      destinationChainId: params.destinationChainId.toString(),
      callTarget: params.callTarget,
      routeHash: params.routeHash,
      minReceive: params.minReceive.toString(),
      maxTotalFeeWei: params.maxTotalFeeWei.toString(),
      overheadGasUnits: params.overheadGasUnits.toString(),
      protocolFeeGasUnits: params.protocolFeeGasUnits.toString(),
      extraFeeWei: params.extraFeeWei.toString(),
      reimbGasPriceCapWei: params.reimbGasPriceCapWei.toString(),
      deadline: params.deadline.toString(),
      nonce: params.nonce.toString(),
    },
  };
}

/**
 * Build SweepIntent params from a quote response
 *
 * @param quote - Quote response from the API
 * @returns SweepIntent parameters
 *
 * @example
 * const params = buildSweepIntentFromQuote(quote);
 */
export function buildSweepIntentFromQuote(quote: {
  mode: number;
  userAddress: Address;
  destination: Address;
  destinationChainId: number;
  callTarget?: Address;
  routeHash?: Hex;
  minReceive: string;
  maxTotalFeeWei: string;
  overheadGasUnits: string;
  protocolFeeGasUnits: string;
  extraFeeWei: string;
  reimbGasPriceCapWei: string;
  deadline: number;
  nonce: number;
}): SweepIntentParams {
  return {
    mode: quote.mode,
    user: quote.userAddress,
    destination: quote.destination,
    destinationChainId: BigInt(quote.destinationChainId),
    callTarget: quote.callTarget ?? ZERO_ADDRESS,
    routeHash: quote.routeHash ?? ZERO_ROUTE_HASH,
    minReceive: BigInt(quote.minReceive),
    maxTotalFeeWei: BigInt(quote.maxTotalFeeWei),
    overheadGasUnits: BigInt(quote.overheadGasUnits),
    protocolFeeGasUnits: BigInt(quote.protocolFeeGasUnits),
    extraFeeWei: BigInt(quote.extraFeeWei),
    reimbGasPriceCapWei: BigInt(quote.reimbGasPriceCapWei),
    deadline: BigInt(quote.deadline),
    nonce: BigInt(quote.nonce),
  };
}

/**
 * Validate that a SweepIntent has valid values
 *
 * @param params - SweepIntent parameters
 * @throws If any value is invalid
 */
export function validateSweepIntentParams(params: SweepIntentParams): void {
  // Mode validation
  if (params.mode !== MODE_TRANSFER && params.mode !== MODE_CALL) {
    throw new Error(`Invalid mode: ${params.mode}. Must be 0 (transfer) or 1 (call)`);
  }

  // For MODE_TRANSFER, callTarget must be zero address
  if (params.mode === MODE_TRANSFER && params.callTarget !== ZERO_ADDRESS) {
    throw new Error('MODE_TRANSFER requires callTarget to be address(0)');
  }

  // For MODE_CALL, callTarget must NOT be zero address
  if (params.mode === MODE_CALL && params.callTarget === ZERO_ADDRESS) {
    throw new Error('MODE_CALL requires a valid callTarget');
  }

  // Deadline validation
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (params.deadline <= now) {
    throw new Error('Deadline must be in the future');
  }

  // Non-negative values
  if (params.maxTotalFeeWei < 0n) {
    throw new Error('maxTotalFeeWei must be non-negative');
  }
  if (params.minReceive < 0n) {
    throw new Error('minReceive must be non-negative');
  }
}
