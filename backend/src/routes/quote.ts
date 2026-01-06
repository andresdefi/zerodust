import type { FastifyPluginAsync } from 'fastify';
import { formatUnits, parseUnits, type Address } from 'viem';
import { getBalance, getGasPrice } from '../lib/viem.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { chains, isChainSupported } from '../config/chains.js';
import { getBungeeQuote } from '../services/bungee.js';
import type { Quote } from '../types/database.js';

// Quote validity period in seconds
const QUOTE_VALIDITY_SECONDS = 60;

// Gas limit estimate for sweep transactions
const SWEEP_GAS_LIMIT = 150000n;

// Service fee: 5% with $0.10 min, $2.00 max
// For simplicity, we use fixed values in native token for now
// In production, use price feeds
const MIN_SERVICE_FEE_USD = 0.10;
const MAX_SERVICE_FEE_USD = 2.00;
const SERVICE_FEE_PERCENT = 0.05;

// Approximate USD prices (in production, use Chainlink or similar)
const NATIVE_TOKEN_USD: Record<string, number> = {
  ETH: 3000,
  BNB: 600,
  POL: 0.50,
  xDAI: 1,
  tBNB: 600, // BSC Testnet
  BERA: 5, // Berachain (testnet estimate)
  XPL: 1, // Plasma (testnet estimate)
  MNT: 0.80, // Mantle
};

function calculateServiceFee(
  balance: bigint,
  nativeToken: string,
  decimals: number
): bigint {
  const tokenPrice = NATIVE_TOKEN_USD[nativeToken] ?? 1;
  const balanceFormatted = parseFloat(formatUnits(balance, decimals));
  const balanceUsd = balanceFormatted * tokenPrice;

  // Calculate 5% fee
  let feeUsd = balanceUsd * SERVICE_FEE_PERCENT;

  // Apply min/max
  feeUsd = Math.max(MIN_SERVICE_FEE_USD, Math.min(MAX_SERVICE_FEE_USD, feeUsd));

  // Convert back to native token
  const feeNative = feeUsd / tokenPrice;

  return parseUnits(feeNative.toFixed(decimals), decimals);
}

async function getNextNonce(userAddress: string, chainId: number): Promise<number> {
  // Get or create nonce record
  const { data, error } = await supabaseAdmin
    .from('nonces')
    .select('current_nonce')
    .eq('user_address', userAddress.toLowerCase())
    .eq('chain_id', chainId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get nonce: ${error.message}`);
  }

  if (!data) {
    // Create new nonce record
    await supabaseAdmin.from('nonces').insert({
      user_address: userAddress.toLowerCase(),
      chain_id: chainId,
      current_nonce: 0,
    });
    return 0;
  }

  return data.current_nonce as number;
}

export const quoteRoutes: FastifyPluginAsync = async (app) => {
  app.get('/quote', {
    schema: {
      tags: ['quote'],
      summary: 'Get a quote for sweeping native balance',
      querystring: {
        type: 'object',
        properties: {
          fromChainId: { type: 'number' },
          toChainId: { type: 'number' },
          userAddress: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
          destination: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
        },
        required: ['fromChainId', 'toChainId', 'userAddress', 'destination'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            quoteId: { type: 'string' },
            userBalance: { type: 'string' },
            estimatedReceive: { type: 'string' },
            breakdown: {
              type: 'object',
              properties: {
                gasCost: { type: 'string' },
                serviceFee: { type: 'string' },
                bridgeFee: { type: 'string' },
                totalFee: { type: 'string' },
              },
            },
            gasParams: {
              type: 'object',
              properties: {
                maxFeePerGas: { type: 'string' },
                maxPriorityFeePerGas: { type: 'string' },
                gasLimit: { type: 'number' },
              },
            },
            deadline: { type: 'number' },
            nonce: { type: 'number' },
            validForSeconds: { type: 'number' },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { fromChainId, toChainId, userAddress, destination } = request.query as {
      fromChainId: number;
      toChainId: number;
      userAddress: string;
      destination: string;
    };

    // Validate chains
    if (!isChainSupported(fromChainId)) {
      return reply.status(400).send({ error: 'Source chain not supported', code: 'INVALID_FROM_CHAIN' });
    }
    if (!isChainSupported(toChainId)) {
      return reply.status(400).send({ error: 'Destination chain not supported', code: 'INVALID_TO_CHAIN' });
    }

    const fromChain = chains[fromChainId]!;

    // Get user balance
    const balance = await getBalance(fromChainId, userAddress as Address);

    if (balance < fromChain.minBalance) {
      return reply.status(400).send({
        error: `Balance too low. Minimum: ${formatUnits(fromChain.minBalance, fromChain.nativeTokenDecimals)} ${fromChain.nativeToken}`,
        code: 'BALANCE_TOO_LOW',
      });
    }

    // Get gas price
    const gasPrice = await getGasPrice(fromChainId);
    // Add 20% buffer for gas price volatility
    const maxFeePerGas = (gasPrice * 120n) / 100n;
    const maxPriorityFeePerGas = maxFeePerGas / 10n; // ~10% of max fee

    // Calculate gas cost
    const gasCost = maxFeePerGas * SWEEP_GAS_LIMIT;

    // Calculate service fee
    const serviceFee = calculateServiceFee(balance, fromChain.nativeToken, fromChain.nativeTokenDecimals);

    // Calculate bridge fee (if cross-chain)
    let bridgeFee = 0n;
    if (fromChainId !== toChainId) {
      try {
        const bungeeQuote = await getBungeeQuote({
          fromChainId,
          toChainId,
          fromTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Native token
          toTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
          amount: balance - gasCost - serviceFee,
          userAddress: userAddress as Address,
        });
        bridgeFee = BigInt(bungeeQuote.bridgeFee);
      } catch (err) {
        app.log.warn({ err }, 'Failed to get Bungee quote, using estimate');
        // Fallback: estimate bridge fee as 0.5% of balance
        bridgeFee = balance / 200n;
      }
    }

    // Calculate total deductions
    const totalFee = gasCost + serviceFee + bridgeFee;
    const maxRelayerCompensation = gasCost + serviceFee; // What relayer keeps

    // Check if user will receive anything
    if (balance <= totalFee) {
      return reply.status(400).send({
        error: 'Balance too low to cover fees',
        code: 'INSUFFICIENT_FOR_FEES',
      });
    }

    const estimatedReceive = balance - totalFee;

    // Get next nonce
    const nonce = await getNextNonce(userAddress, fromChainId);

    // Set deadline
    const deadline = Math.floor(Date.now() / 1000) + QUOTE_VALIDITY_SECONDS;
    const expiresAt = new Date(deadline * 1000).toISOString();

    // Store quote in database
    const { data: quote, error } = await supabaseAdmin
      .from('quotes')
      .insert({
        user_address: userAddress.toLowerCase(),
        from_chain_id: fromChainId,
        to_chain_id: toChainId,
        destination: destination.toLowerCase(),
        user_balance: balance.toString(),
        estimated_receive: estimatedReceive.toString(),
        gas_cost: gasCost.toString(),
        service_fee: serviceFee.toString(),
        bridge_fee: bridgeFee.toString(),
        max_relayer_compensation: maxRelayerCompensation.toString(),
        max_fee_per_gas: maxFeePerGas.toString(),
        max_priority_fee_per_gas: maxPriorityFeePerGas.toString(),
        gas_limit: Number(SWEEP_GAS_LIMIT),
        deadline,
        nonce,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error || !quote) {
      app.log.error({ error }, 'Failed to store quote');
      return reply.status(500).send({ error: 'Failed to create quote', code: 'INTERNAL_ERROR' });
    }

    const quoteData = quote as Quote;
    return {
      quoteId: quoteData.id,
      userBalance: balance.toString(),
      estimatedReceive: estimatedReceive.toString(),
      breakdown: {
        gasCost: gasCost.toString(),
        serviceFee: serviceFee.toString(),
        bridgeFee: bridgeFee.toString(),
        totalFee: totalFee.toString(),
      },
      gasParams: {
        maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
        gasLimit: Number(SWEEP_GAS_LIMIT),
      },
      deadline,
      nonce,
      validForSeconds: QUOTE_VALIDITY_SECONDS,
    };
  });
};
