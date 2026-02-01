/**
 * @fileoverview Tests for EIP-712 signature utilities
 */

import { describe, it, expect } from 'vitest';
import { keccak256, toHex } from 'viem';
import {
  DOMAIN_NAME,
  DOMAIN_VERSION,
  MODE_TRANSFER,
  MODE_CALL,
  ZERO_ADDRESS,
  ZERO_ROUTE_HASH,
  SWEEP_INTENT_TYPES,
  computeRouteHash,
  buildSweepIntentTypedData,
  buildSweepIntentFromQuote,
  validateSweepIntentParams,
  type SweepIntentParams,
} from '../src/utils/signature.js';

describe('Constants', () => {
  it('should have correct domain constants', () => {
    expect(DOMAIN_NAME).toBe('ZeroDustSweep');
    expect(DOMAIN_VERSION).toBe('1');
  });

  it('should have correct mode constants', () => {
    expect(MODE_TRANSFER).toBe(0);
    expect(MODE_CALL).toBe(1);
  });

  it('should have correct zero constants', () => {
    expect(ZERO_ADDRESS).toBe('0x0000000000000000000000000000000000000000');
    expect(ZERO_ROUTE_HASH).toBe(keccak256(toHex('')));
  });

  it('should have correct SweepIntent types', () => {
    expect(SWEEP_INTENT_TYPES.SweepIntent).toHaveLength(14);
    expect(SWEEP_INTENT_TYPES.SweepIntent[0]).toEqual({ name: 'mode', type: 'uint8' });
    expect(SWEEP_INTENT_TYPES.SweepIntent[13]).toEqual({ name: 'nonce', type: 'uint256' });
  });
});

describe('computeRouteHash', () => {
  it('should compute keccak256 of callData', () => {
    const callData = '0x1234567890abcdef';
    const hash = computeRouteHash(callData);

    expect(hash).toBe(keccak256(callData));
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should produce different hashes for different data', () => {
    const hash1 = computeRouteHash('0x1234');
    const hash2 = computeRouteHash('0x5678');

    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty callData (0x)', () => {
    const hash = computeRouteHash('0x');
    expect(hash).toBe(keccak256('0x'));
  });
});

describe('buildSweepIntentTypedData', () => {
  const userAddress = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
  const destination = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

  const sameChainParams: SweepIntentParams = {
    mode: MODE_TRANSFER,
    user: userAddress,
    destination: destination,
    destinationChainId: 8453n,
    callTarget: ZERO_ADDRESS,
    routeHash: ZERO_ROUTE_HASH,
    minReceive: 900000000000000n,
    maxTotalFeeWei: 100000000000000n,
    overheadGasUnits: 100000n,
    protocolFeeGasUnits: 0n,
    extraFeeWei: 50000000000000n,
    reimbGasPriceCapWei: 1000000000n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
    nonce: 0n,
  };

  it('should build valid typed data for same-chain sweep', () => {
    const typedData = buildSweepIntentTypedData(8453, userAddress, sameChainParams);

    // Check structure
    expect(typedData.primaryType).toBe('SweepIntent');
    expect(typedData.domain.name).toBe(DOMAIN_NAME);
    expect(typedData.domain.version).toBe(DOMAIN_VERSION);
    expect(typedData.domain.chainId).toBe(8453);

    // CRITICAL: verifyingContract should be user's EOA, not contract
    expect(typedData.domain.verifyingContract).toBe(userAddress);
  });

  it('should include all EIP712Domain fields', () => {
    const typedData = buildSweepIntentTypedData(8453, userAddress, sameChainParams);

    const domainFields = typedData.types.EIP712Domain;
    expect(domainFields).toContainEqual({ name: 'name', type: 'string' });
    expect(domainFields).toContainEqual({ name: 'version', type: 'string' });
    expect(domainFields).toContainEqual({ name: 'chainId', type: 'uint256' });
    expect(domainFields).toContainEqual({ name: 'verifyingContract', type: 'address' });
  });

  it('should include all SweepIntent fields in types', () => {
    const typedData = buildSweepIntentTypedData(8453, userAddress, sameChainParams);

    const intentFields = typedData.types.SweepIntent;
    expect(intentFields).toHaveLength(14);
  });

  it('should convert bigints to strings in message', () => {
    const typedData = buildSweepIntentTypedData(8453, userAddress, sameChainParams);

    expect(typedData.message['destinationChainId']).toBe('8453');
    expect(typedData.message['minReceive']).toBe('900000000000000');
    expect(typedData.message['maxTotalFeeWei']).toBe('100000000000000');
  });

  it('should preserve address case in message', () => {
    const typedData = buildSweepIntentTypedData(8453, userAddress, sameChainParams);

    expect(typedData.message['user']).toBe(userAddress);
    expect(typedData.message['destination']).toBe(destination);
  });

  it('should work for cross-chain sweep', () => {
    const crossChainParams: SweepIntentParams = {
      ...sameChainParams,
      mode: MODE_CALL,
      destinationChainId: 42161n, // Arbitrum
      callTarget: '0x1111111111111111111111111111111111111111',
      routeHash: computeRouteHash('0xabcd1234'),
    };

    const typedData = buildSweepIntentTypedData(8453, userAddress, crossChainParams);

    expect(typedData.message['mode']).toBe(MODE_CALL);
    expect(typedData.message['destinationChainId']).toBe('42161');
    expect(typedData.message['callTarget']).toBe('0x1111111111111111111111111111111111111111');
  });
});

describe('buildSweepIntentFromQuote', () => {
  it('should convert quote fields to SweepIntentParams', () => {
    const quote = {
      mode: MODE_TRANSFER,
      userAddress: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      destination: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      destinationChainId: 8453,
      minReceive: '900000000000000',
      maxTotalFeeWei: '100000000000000',
      overheadGasUnits: '100000',
      protocolFeeGasUnits: '0',
      extraFeeWei: '50000000000000',
      reimbGasPriceCapWei: '1000000000',
      deadline: 1706745600,
      nonce: 0,
    };

    const params = buildSweepIntentFromQuote(quote);

    expect(params.mode).toBe(MODE_TRANSFER);
    expect(params.user).toBe(quote.userAddress);
    expect(params.destinationChainId).toBe(8453n);
    expect(params.minReceive).toBe(900000000000000n);
    expect(params.deadline).toBe(1706745600n);
    expect(params.nonce).toBe(0n);
  });

  it('should use defaults for optional fields', () => {
    const quote = {
      mode: MODE_TRANSFER,
      userAddress: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      destination: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      destinationChainId: 8453,
      minReceive: '900000000000000',
      maxTotalFeeWei: '100000000000000',
      overheadGasUnits: '100000',
      protocolFeeGasUnits: '0',
      extraFeeWei: '50000000000000',
      reimbGasPriceCapWei: '1000000000',
      deadline: 1706745600,
      nonce: 0,
      // No callTarget or routeHash
    };

    const params = buildSweepIntentFromQuote(quote);

    expect(params.callTarget).toBe(ZERO_ADDRESS);
    expect(params.routeHash).toBe(ZERO_ROUTE_HASH);
  });
});

describe('validateSweepIntentParams', () => {
  const futureDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now

  const validParams: SweepIntentParams = {
    mode: MODE_TRANSFER,
    user: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    destination: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    destinationChainId: 8453n,
    callTarget: ZERO_ADDRESS,
    routeHash: ZERO_ROUTE_HASH,
    minReceive: 900000000000000n,
    maxTotalFeeWei: 100000000000000n,
    overheadGasUnits: 100000n,
    protocolFeeGasUnits: 0n,
    extraFeeWei: 50000000000000n,
    reimbGasPriceCapWei: 1000000000n,
    deadline: futureDeadline,
    nonce: 0n,
  };

  it('should accept valid MODE_TRANSFER params', () => {
    expect(() => validateSweepIntentParams(validParams)).not.toThrow();
  });

  it('should accept valid MODE_CALL params', () => {
    const callParams = {
      ...validParams,
      mode: MODE_CALL,
      callTarget: '0x1111111111111111111111111111111111111111',
      routeHash: computeRouteHash('0xabcd'),
    };
    expect(() => validateSweepIntentParams(callParams)).not.toThrow();
  });

  it('should reject invalid mode', () => {
    expect(() => validateSweepIntentParams({ ...validParams, mode: 2 })).toThrow(/Invalid mode/);
  });

  it('should reject MODE_TRANSFER with non-zero callTarget', () => {
    expect(() =>
      validateSweepIntentParams({
        ...validParams,
        callTarget: '0x1111111111111111111111111111111111111111',
      })
    ).toThrow(/MODE_TRANSFER requires callTarget to be address\(0\)/);
  });

  it('should reject MODE_CALL with zero callTarget', () => {
    expect(() =>
      validateSweepIntentParams({
        ...validParams,
        mode: MODE_CALL,
        callTarget: ZERO_ADDRESS,
      })
    ).toThrow(/MODE_CALL requires a valid callTarget/);
  });

  it('should reject expired deadline', () => {
    const pastDeadline = BigInt(Math.floor(Date.now() / 1000) - 60);
    expect(() =>
      validateSweepIntentParams({
        ...validParams,
        deadline: pastDeadline,
      })
    ).toThrow(/Deadline must be in the future/);
  });

  it('should reject negative maxTotalFeeWei', () => {
    expect(() =>
      validateSweepIntentParams({
        ...validParams,
        maxTotalFeeWei: -1n,
      })
    ).toThrow(/maxTotalFeeWei must be non-negative/);
  });

  it('should reject negative minReceive', () => {
    expect(() =>
      validateSweepIntentParams({
        ...validParams,
        minReceive: -1n,
      })
    ).toThrow(/minReceive must be non-negative/);
  });
});
