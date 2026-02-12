/**
 * @fileoverview Vercel AI SDK tool definitions for ZeroDust
 */

import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import { ZeroDust, type ZeroDustConfig } from '@zerodust/sdk';

export interface ZeroDustToolsConfig extends ZeroDustConfig {}

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/**
 * Create all ZeroDust tools for the Vercel AI SDK
 *
 * @param config - ZeroDust SDK configuration
 * @returns Record of tool name to CoreTool, for use with generateText/streamText
 *
 * @example
 * ```typescript
 * import { createZeroDustTools } from '@zerodust/ai-sdk';
 * import { generateText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 *
 * const tools = createZeroDustTools({ environment: 'mainnet' });
 *
 * const result = await generateText({
 *   model: openai('gpt-4o'),
 *   tools,
 *   prompt: 'Check balances for 0x1234...',
 * });
 * ```
 */
export function createZeroDustTools(
  config: ZeroDustToolsConfig = {}
): Record<string, CoreTool> {
  const client = new ZeroDust(config);

  return {
    zerodust_info: tool({
      description:
        'Get information about ZeroDust service, including what it does, fee structure, and how to use it. Use this tool when the user asks about ZeroDust or needs to understand the service.',
      parameters: z.object({}),
      execute: async () => {
        return {
          name: 'ZeroDust',
          tagline: 'Sweep native gas tokens to exactly zero',
          description:
            'ZeroDust sweeps 100% of native gas tokens (ETH, BNB, POL, etc.) from any supported EVM chain, leaving exactly zero balance. Funds are sent to any address on the same or a different chain.',
          howItWorks: [
            'User signs an EIP-7702 authorization (delegates their EOA temporarily)',
            'User signs an EIP-712 sweep intent (specifies destination and limits)',
            "ZeroDust's relayer executes the sweep atomically",
            "User's balance goes to exactly zero, funds arrive at destination",
            'Delegation is automatically revoked after sweep',
          ],
          fees: {
            freeTier: 'No service fee for sweeps under $1',
            standard: '1% service fee (min $0.05, max $0.50)',
            gas: 'Paid by relayer, reimbursed from swept amount',
            guarantee: 'Users always receive the quoted amount or more',
          },
          supportedChains: '25+ EVM chains including Ethereum, Arbitrum, Base, Optimism, Polygon, BSC, Gnosis, and more',
          integration: {
            sdk: 'npm install @zerodust/sdk viem',
            api: 'POST /quote, POST /sweep, GET /sweep/:id/status',
            mcp: '@zerodust/mcp-server (stdio transport)',
            langchain: '@zerodust/langchain',
            vercelAiSdk: '@zerodust/ai-sdk',
          },
        };
      },
    }),

    zerodust_get_chains: tool({
      description:
        'Get a list of all blockchain chains supported by ZeroDust for sweeping native gas tokens. Returns chain IDs, names, native tokens, and whether they are enabled.',
      parameters: z.object({}),
      execute: async () => {
        const chains = await client.getChains();
        const enabled = chains.filter((c) => c.enabled);
        return {
          count: enabled.length,
          chains: enabled.map((c) => ({
            chainId: c.chainId,
            name: c.name,
            nativeToken: c.nativeToken,
          })),
        };
      },
    }),

    zerodust_get_balances: tool({
      description:
        'Check native gas token balances across all supported chains for a wallet address. Shows which chains have sweepable balances.',
      parameters: z.object({
        address: z
          .string()
          .regex(ETH_ADDRESS_REGEX)
          .describe('Ethereum wallet address (0x...)'),
      }),
      execute: async ({ address }) => {
        const data = await client.getBalances(address);
        const sweepable = data.chains.filter((b) => b.canSweep);
        const nonZero = data.chains.filter(
          (b) => b.balance !== '0' && !b.canSweep
        );

        return {
          sweepable: sweepable.map((b) => ({
            chainId: b.chainId,
            name: b.name,
            nativeToken: b.nativeToken,
            balance: b.balanceFormatted,
          })),
          tooSmall: nonZero.map((b) => ({
            chainId: b.chainId,
            name: b.name,
            nativeToken: b.nativeToken,
            balance: b.balanceFormatted,
          })),
        };
      },
    }),

    zerodust_get_quote: tool({
      description:
        'Get a quote for sweeping native gas tokens from one chain. Returns the estimated amount the user will receive, fee breakdown, and a quote ID. Quotes expire in 60 seconds.',
      parameters: z.object({
        fromChainId: z
          .number()
          .int()
          .positive()
          .describe('Source chain ID to sweep from'),
        toChainId: z
          .number()
          .int()
          .positive()
          .describe('Destination chain ID to receive funds'),
        userAddress: z
          .string()
          .regex(ETH_ADDRESS_REGEX)
          .describe("User's wallet address to sweep from"),
        destination: z
          .string()
          .regex(ETH_ADDRESS_REGEX)
          .describe('Destination address to receive swept funds'),
      }),
      execute: async ({
        fromChainId,
        toChainId,
        userAddress,
        destination,
      }) => {
        const data = await client.getQuote({
          fromChainId,
          toChainId,
          userAddress: userAddress as `0x${string}`,
          destination: destination as `0x${string}`,
        });

        return {
          quoteId: data.quoteId,
          userBalance: data.userBalance,
          estimatedReceive: data.estimatedReceive,
          mode: data.mode === 0 ? 'same-chain' : 'cross-chain',
          maxTotalFee: data.fees.maxTotalFeeWei,
          validForSeconds: data.validForSeconds,
          note: 'To execute this sweep, the user must sign the EIP-712 typed data and EIP-7702 authorization using the SDK.',
        };
      },
    }),

    zerodust_get_sweep_status: tool({
      description:
        'Check the status of a previously submitted sweep. Returns the current status (pending, simulating, executing, bridging, completed, failed), transaction hash if available, and error messages if failed.',
      parameters: z.object({
        sweepId: z
          .string()
          .uuid()
          .describe('The sweep ID returned from submitting a sweep'),
      }),
      execute: async ({ sweepId }) => {
        const data = await client.getSweepStatus(sweepId);
        return {
          sweepId: data.sweepId,
          status: data.status,
          sweepType: data.sweepType,
          fromChainId: data.fromChainId,
          toChainId: data.toChainId,
          destination: data.destination,
          txHash: data.txHash ?? null,
          bridgeTrackingUrl: data.bridgeTrackingUrl ?? null,
          errorMessage: data.errorMessage ?? null,
        };
      },
    }),

    zerodust_list_sweeps: tool({
      description:
        'List past sweeps for a wallet address. Shows sweep history with status and amounts.',
      parameters: z.object({
        address: z
          .string()
          .regex(ETH_ADDRESS_REGEX)
          .describe('Wallet address to list sweeps for'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum number of results (default: 10)'),
      }),
      execute: async ({ address, limit }) => {
        const data = await client.getSweeps(address, {
          limit: limit ?? 10,
        });

        return {
          total: data.total,
          sweeps: data.sweeps.map((s) => ({
            sweepId: s.sweepId,
            status: s.status,
            sweepType: s.sweepType,
            fromChainId: s.fromChainId,
            toChainId: s.toChainId,
            amountSent: s.amountSent ?? null,
            txHash: s.txHash ?? null,
            createdAt: s.createdAt,
          })),
        };
      },
    }),
  };
}
