/**
 * @fileoverview LangChain tool definitions for ZeroDust
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { ZeroDust, type ZeroDustConfig } from '@zerodust/sdk';

export interface ZeroDustToolsConfig extends ZeroDustConfig {}

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/**
 * Create all ZeroDust LangChain tools
 *
 * @param config - ZeroDust SDK configuration
 * @returns Array of LangChain tools
 *
 * @example
 * ```typescript
 * import { createZeroDustTools } from '@zerodust/langchain';
 * import { ChatOpenAI } from '@langchain/openai';
 * import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
 *
 * const tools = createZeroDustTools({ environment: 'mainnet' });
 * const llm = new ChatOpenAI({ model: 'gpt-4' });
 * const agent = createToolCallingAgent({ llm, tools, prompt });
 * ```
 */
export function createZeroDustTools(
  config: ZeroDustToolsConfig = {}
): DynamicStructuredTool[] {
  const client = new ZeroDust(config);

  return [
    createInfoTool(),
    createGetChainsTool(client),
    createGetBalancesTool(client),
    createGetQuoteTool(client),
    createGetSweepStatusTool(client),
    createListSweepsTool(client),
  ];
}

function createInfoTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'zerodust_info',
    description:
      'Get information about ZeroDust service, including what it does, fee structure, and how to use it. Use this tool when the user asks about ZeroDust or needs to understand the service.',
    schema: z.object({}),
    func: async () => {
      return [
        'ZeroDust - Sweep native gas tokens to exactly zero',
        '',
        'What it does:',
        '  ZeroDust sweeps 100% of native gas tokens (ETH, BNB, POL, etc.) from any',
        '  supported EVM chain, leaving exactly zero balance. Funds are sent to any',
        '  address on the same or a different chain.',
        '',
        'How it works:',
        '  1. User signs an EIP-7702 authorization (delegates their EOA temporarily)',
        '  2. User signs an EIP-712 sweep intent (specifies destination and limits)',
        '  3. ZeroDust\'s relayer executes the sweep atomically',
        '  4. User\'s balance goes to exactly zero, funds arrive at destination',
        '  5. Delegation is automatically revoked after sweep',
        '',
        'Fee structure:',
        '  - Free tier: No service fee for sweeps under $1',
        '  - Standard: 1% service fee (min $0.05, max $0.50)',
        '  - Gas costs: Paid by relayer, reimbursed from swept amount',
        '  - Users always receive the quoted amount or more',
        '',
        'Supported chains: 25+ EVM chains including Ethereum, Arbitrum, Base,',
        '  Optimism, Polygon, BSC, Gnosis, and more.',
        '',
        'Integration:',
        '  - SDK: npm install @zerodust/sdk viem',
        '  - API: POST /quote, POST /sweep, GET /sweep/:id/status',
        '  - MCP: @zerodust/mcp-server (stdio transport)',
        '  - LangChain: @zerodust/langchain',
        '  - Vercel AI SDK: @zerodust/ai-sdk',
      ].join('\n');
    },
  });
}

function createGetChainsTool(client: ZeroDust): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'zerodust_get_chains',
    description:
      'Get a list of all blockchain chains supported by ZeroDust for sweeping native gas tokens. Returns chain IDs, names, native tokens, and whether they are enabled.',
    schema: z.object({}),
    func: async () => {
      const chains = await client.getChains();
      const enabled = chains.filter((c) => c.enabled);
      const text = enabled
        .map((c) => `${c.name} (chainId: ${c.chainId}) - ${c.nativeToken}`)
        .join('\n');
      return `Supported chains (${enabled.length}):\n${text}`;
    },
  });
}

function createGetBalancesTool(client: ZeroDust): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'zerodust_get_balances',
    description:
      'Check native gas token balances across all supported chains for a wallet address. Shows which chains have sweepable balances.',
    schema: z.object({
      address: z
        .string()
        .regex(ETH_ADDRESS_REGEX)
        .describe('Ethereum wallet address (0x...)'),
    }),
    func: async ({ address }) => {
      const data = await client.getBalances(address);
      const sweepable = data.chains.filter((b) => b.canSweep);
      const nonZero = data.chains.filter(
        (b) => b.balance !== '0' && !b.canSweep
      );

      let text = '';
      if (sweepable.length > 0) {
        text += `Sweepable balances (${sweepable.length}):\n`;
        text += sweepable
          .map(
            (b) =>
              `  ${b.name}: ${b.balanceFormatted} ${b.nativeToken} (chainId: ${b.chainId})`
          )
          .join('\n');
      } else {
        text += 'No sweepable balances found.';
      }

      if (nonZero.length > 0) {
        text += `\n\nToo small to sweep (${nonZero.length}):\n`;
        text += nonZero
          .map(
            (b) => `  ${b.name}: ${b.balanceFormatted} ${b.nativeToken}`
          )
          .join('\n');
      }

      return text;
    },
  });
}

function createGetQuoteTool(client: ZeroDust): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'zerodust_get_quote',
    description:
      'Get a quote for sweeping native gas tokens from one chain. Returns the estimated amount the user will receive, fee breakdown, and a quote ID. Quotes expire in 60 seconds.',
    schema: z.object({
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
    func: async ({ fromChainId, toChainId, userAddress, destination }) => {
      const data = await client.getQuote({
        fromChainId,
        toChainId,
        userAddress: userAddress as `0x${string}`,
        destination: destination as `0x${string}`,
      });

      return [
        `Quote ID: ${data.quoteId}`,
        `Balance: ${data.userBalance} wei`,
        `Estimated receive: ${data.estimatedReceive} wei`,
        `Mode: ${data.mode === 0 ? 'Same-chain transfer' : 'Cross-chain bridge'}`,
        `Max total fee: ${data.fees.maxTotalFeeWei} wei`,
        `Valid for: ${data.validForSeconds} seconds`,
        '',
        'To execute this sweep, the user must sign the EIP-712 typed data and EIP-7702 authorization using the SDK.',
      ].join('\n');
    },
  });
}

function createGetSweepStatusTool(client: ZeroDust): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'zerodust_get_sweep_status',
    description:
      'Check the status of a previously submitted sweep. Returns the current status (pending, simulating, executing, bridging, completed, failed), transaction hash if available, and error messages if failed.',
    schema: z.object({
      sweepId: z
        .string()
        .uuid()
        .describe('The sweep ID returned from submitting a sweep'),
    }),
    func: async ({ sweepId }) => {
      const data = await client.getSweepStatus(sweepId);

      const lines = [
        `Sweep ID: ${data.sweepId}`,
        `Status: ${data.status}`,
        `Type: ${data.sweepType}`,
        `From chain: ${data.fromChainId} → To chain: ${data.toChainId}`,
        `Destination: ${data.destination}`,
      ];

      if (data.txHash) {
        lines.push(`TX Hash: ${data.txHash}`);
      }
      if (data.bridgeTrackingUrl) {
        lines.push(`Bridge tracking: ${data.bridgeTrackingUrl}`);
      }
      if (data.errorMessage) {
        lines.push(`Error: ${data.errorMessage}`);
      }

      return lines.join('\n');
    },
  });
}

function createListSweepsTool(client: ZeroDust): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'zerodust_list_sweeps',
    description:
      'List past sweeps for a wallet address. Shows sweep history with status and amounts.',
    schema: z.object({
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
    func: async ({ address, limit }) => {
      const data = await client.getSweeps(address, { limit: limit ?? 10 });

      if (data.sweeps.length === 0) {
        return 'No sweeps found for this address.';
      }

      const text = data.sweeps
        .map((s) => {
          const lines = [
            `[${s.status}] ${s.fromChainId} → ${s.toChainId} (${s.sweepType})`,
          ];
          if (s.amountSent) lines.push(`  Amount: ${s.amountSent} wei`);
          if (s.txHash) lines.push(`  TX: ${s.txHash}`);
          lines.push(`  Created: ${s.createdAt}`);
          return lines.join('\n');
        })
        .join('\n\n');

      return `Sweeps for ${address} (${data.total} total):\n\n${text}`;
    },
  });
}
