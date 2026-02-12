#!/usr/bin/env node

/**
 * @fileoverview ZeroDust MCP Server
 *
 * Model Context Protocol server that exposes ZeroDust tools for AI agents.
 * Uses stdio transport for integration with Claude Desktop, Claude Code,
 * and other MCP-compatible clients.
 *
 * Usage:
 *   npx @zerodust/mcp-server
 *
 * Configuration via environment variables:
 *   ZERODUST_API_URL - Custom API URL (default: https://api.zerodust.xyz)
 *   ZERODUST_API_KEY - Optional API key for higher rate limits
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.ZERODUST_API_URL || "https://api.zerodust.xyz";
const API_KEY = process.env.ZERODUST_API_KEY;

const server = new McpServer({
  name: "zerodust",
  version: "0.1.0",
});

// Helper to make API requests
async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "zerodust-mcp-server/0.1.0",
  };
  if (API_KEY) {
    headers["x-api-key"] = API_KEY;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`ZeroDust API error (${response.status}): ${(error as Record<string, string>).error || response.statusText}`);
  }

  return response.json() as Promise<T>;
}

// ============ Tool: Get Supported Chains ============

server.registerTool(
  "zerodust_get_chains",
  {
    description:
      "Get a list of all blockchain chains supported by ZeroDust for sweeping native gas tokens. Returns chain IDs, names, native tokens, and contract addresses.",
    inputSchema: {},
  },
  async () => {
    try {
      const data = await apiRequest<{
        chains: Array<{
          chainId: number;
          name: string;
          nativeToken: string;
          enabled: boolean;
          contractAddress: string;
        }>;
      }>("/chains");

      const enabledChains = data.chains.filter((c) => c.enabled);
      const text = enabledChains
        .map(
          (c) => `${c.name} (chainId: ${c.chainId}) - ${c.nativeToken}`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Supported chains (${enabledChains.length}):\n${text}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching chains: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ============ Tool: Get Balances ============

server.registerTool(
  "zerodust_get_balances",
  {
    description:
      "Check native gas token balances across all supported chains for a wallet address. Shows which chains have sweepable balances and their USD values.",
    inputSchema: {
      address: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/)
        .describe("Ethereum wallet address (0x...)"),
    },
  },
  async ({ address }) => {
    try {
      const data = await apiRequest<{
        chains: Array<{
          chainId: number;
          name: string;
          nativeToken: string;
          balance: string;
          balanceFormatted: string;
          canSweep: boolean;
        }>;
      }>(`/balances/${address}`);

      const sweepable = data.chains.filter((b) => b.canSweep);
      const nonZero = data.chains.filter(
        (b) => b.balance !== "0" && !b.canSweep
      );

      let text = "";
      if (sweepable.length > 0) {
        text += `Sweepable balances (${sweepable.length}):\n`;
        text += sweepable
          .map(
            (b) =>
              `  ${b.name}: ${b.balanceFormatted} ${b.nativeToken} (chainId: ${b.chainId})`
          )
          .join("\n");
      } else {
        text += "No sweepable balances found.";
      }

      if (nonZero.length > 0) {
        text += `\n\nToo small to sweep (${nonZero.length}):\n`;
        text += nonZero
          .map(
            (b) =>
              `  ${b.name}: ${b.balanceFormatted} ${b.nativeToken}`
          )
          .join("\n");
      }

      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching balances: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ============ Tool: Get Quote ============

server.registerTool(
  "zerodust_get_quote",
  {
    description:
      "Get a quote for sweeping native gas tokens from one chain. Returns the estimated amount the user will receive, fee breakdown, and a quote ID for executing the sweep. Quotes expire in 60 seconds.",
    inputSchema: {
      fromChainId: z.number().int().positive().describe("Source chain ID to sweep from"),
      toChainId: z.number().int().positive().describe("Destination chain ID to receive funds"),
      userAddress: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/)
        .describe("User's wallet address to sweep from"),
      destination: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/)
        .describe("Destination address to receive swept funds"),
    },
  },
  async ({ fromChainId, toChainId, userAddress, destination }) => {
    try {
      const data = await apiRequest<{
        quoteId: string;
        userBalance: string;
        estimatedReceive: string;
        mode: number;
        fees: {
          maxTotalFeeWei: string;
          extraFeeWei: string;
        };
        validForSeconds: number;
      }>("/quote", {
        method: "POST",
        body: { fromChainId, toChainId, userAddress, destination },
      });

      const text = [
        `Quote ID: ${data.quoteId}`,
        `Balance: ${data.userBalance} wei`,
        `Estimated receive: ${data.estimatedReceive} wei`,
        `Mode: ${data.mode === 0 ? "Same-chain transfer" : "Cross-chain bridge"}`,
        `Max total fee: ${data.fees.maxTotalFeeWei} wei`,
        `Valid for: ${data.validForSeconds} seconds`,
        "",
        "To execute this sweep, the user must sign the EIP-712 typed data and EIP-7702 authorization using the SDK.",
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error getting quote: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ============ Tool: Check Sweep Status ============

server.registerTool(
  "zerodust_get_sweep_status",
  {
    description:
      "Check the status of a previously submitted sweep. Returns the current status (pending, simulating, executing, bridging, completed, failed), transaction hash if available, and error messages if failed.",
    inputSchema: {
      sweepId: z
        .string()
        .uuid()
        .describe("The sweep ID returned from submitting a sweep"),
    },
  },
  async ({ sweepId }) => {
    try {
      const data = await apiRequest<{
        sweepId: string;
        status: string;
        sweepType: string;
        txHash?: string;
        destination: string;
        fromChainId: number;
        toChainId: number;
        errorMessage?: string;
        bridgeTrackingUrl?: string;
      }>(`/sweep/${sweepId}/status`);

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

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error checking sweep status: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ============ Tool: List Sweeps ============

server.registerTool(
  "zerodust_list_sweeps",
  {
    description:
      "List past sweeps for a wallet address. Shows sweep history with status and amounts.",
    inputSchema: {
      address: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/)
        .describe("Wallet address to list sweeps for"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum number of results (default: 10)"),
    },
  },
  async ({ address, limit }) => {
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit || 10));

      const data = await apiRequest<{
        sweeps: Array<{
          sweepId: string;
          status: string;
          sweepType: string;
          fromChainId: number;
          toChainId: number;
          amountSent?: string;
          txHash?: string;
          createdAt: string;
        }>;
        total: number;
      }>(`/sweeps/${address}?${params}`);

      if (data.sweeps.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No sweeps found for this address." }],
        };
      }

      const text = data.sweeps
        .map((s) => {
          const lines = [
            `[${s.status}] ${s.fromChainId} → ${s.toChainId} (${s.sweepType})`,
          ];
          if (s.amountSent) lines.push(`  Amount: ${s.amountSent} wei`);
          if (s.txHash) lines.push(`  TX: ${s.txHash}`);
          lines.push(`  Created: ${s.createdAt}`);
          return lines.join("\n");
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Sweeps for ${address} (${data.total} total):\n\n${text}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing sweeps: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ============ Tool: Service Info ============

server.registerTool(
  "zerodust_info",
  {
    description:
      "Get information about ZeroDust service, including what it does, fee structure, and how to use it. Use this tool when the user asks about ZeroDust or needs to understand the service.",
    inputSchema: {},
  },
  async () => {
    return {
      content: [
        {
          type: "text" as const,
          text: [
            "ZeroDust - Sweep native gas tokens to exactly zero",
            "",
            "What it does:",
            "  ZeroDust sweeps 100% of native gas tokens (ETH, BNB, POL, etc.) from any",
            "  supported EVM chain, leaving exactly zero balance. Funds are sent to any",
            "  address on the same or a different chain.",
            "",
            "How it works:",
            "  1. User signs an EIP-7702 authorization (delegates their EOA temporarily)",
            "  2. User signs an EIP-712 sweep intent (specifies destination and limits)",
            "  3. ZeroDust's relayer executes the sweep atomically",
            "  4. User's balance goes to exactly zero, funds arrive at destination",
            "  5. Delegation is automatically revoked after sweep",
            "",
            "Fee structure:",
            "  - Free tier: No service fee for sweeps under $1",
            "  - Standard: 1% service fee (min $0.05, max $0.50)",
            "  - Gas costs: Paid by relayer, reimbursed from swept amount",
            "  - Users always receive the quoted amount or more",
            "",
            "Supported chains: 25+ EVM chains including Ethereum, Arbitrum, Base,",
            "  Optimism, Polygon, BSC, Gnosis, and more.",
            "",
            "Integration:",
            "  - SDK: npm install @zerodust/sdk viem",
            "  - API: POST /quote, POST /sweep, GET /sweep/:id/status",
            "  - MCP: This server (stdio transport)",
          ].join("\n"),
        },
      ],
    };
  }
);

// ============ Start Server ============

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ZeroDust MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
