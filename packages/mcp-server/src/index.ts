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
 *
 * Sweeping is read-only by default. To let an agent actually move funds, see
 * `execute.ts` for the ZERODUST_ALLOW_EXECUTE opt-in and `signer.ts` for the
 * four accepted ways to supply a signing key.
 *
 * Tool descriptions here lead with the problem rather than the product. An
 * agent picks a tool by matching the user's words against a description, and
 * "check balances" collides with every other balance tool in the client. What
 * is actually distinctive is the impossibility ZeroDust removes: you cannot
 * send 100% of a native gas token, because sending it costs it.
 */

import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readExecuteConfig, registerExecuteTools } from "./execute.js";

const API_BASE = process.env.ZERODUST_API_URL || "https://api.zerodust.xyz";
const API_KEY = process.env.ZERODUST_API_KEY;

// Read from package.json rather than hardcoding: the literal here drifted to
// 0.2.1 behind the package and shipped a wrong version over the wire, which
// directory listings surface to users.
const { version: VERSION } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

const server = new McpServer({
  name: "zerodust",
  version: VERSION,
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
      "List the EVM chains a native gas balance can be emptied to exactly zero on. Returns " +
      "chain IDs, names, and native tokens. Call this to check whether a specific chain is " +
      "supported before quoting or sweeping.",
    annotations: {
      title: "List supported chains",
      readOnlyHint: true,
      openWorldHint: true,
    },
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

// ============ Tool: Get Destinations ============

server.registerTool(
  "zerodust_get_destinations",
  {
    description:
      "List the chains a balance on fromChainId can be swept to, receiving that chain's native gas " +
      "(e.g. ETH on Base, BNB on BSC, HYPE on HyperEVM). Destinations are not limited to the chains " +
      "ZeroDust sweeps from: any EVM chain a bridge serves qualifies. Call this before quoting a " +
      "cross-chain sweep to pick where the funds should go.",
    annotations: {
      title: "List sweep destinations",
      readOnlyHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      fromChainId: z.number().int().positive().describe("Source chain ID (a ZeroDust chain)"),
    },
  },
  async ({ fromChainId }) => {
    try {
      const data = await apiRequest<{
        fromChainId: number;
        destinations: Array<{
          chainId: number;
          name: string;
          nativeSymbol: string;
          bridges: string[];
          zerodustChain: boolean;
        }>;
      }>(`/destinations?fromChainId=${fromChainId}`);

      const text = data.destinations
        .map((d) => `${d.name} (chainId: ${d.chainId}) - receives ${d.nativeSymbol} via ${d.bridges.join(", ")}`)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Destinations from chain ${fromChainId} (${data.destinations.length}):\n${text}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching destinations: ${error instanceof Error ? error.message : String(error)}`,
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
      "Find leftover native gas token (ETH, BNB, POL, ...) stranded across every supported EVM " +
      "chain for one address, and report which of it can be recovered. Normally these balances " +
      "are unrecoverable: you cannot transfer 100% of a gas token, because paying for the " +
      "transfer consumes the thing you are transferring, so a remainder is always left behind. " +
      "This reports what is stuck and what could be moved out. Useful when a wallet has small " +
      "amounts scattered over many chains, when someone cannot send their full balance, or " +
      "before closing out, winding down or decommissioning a wallet.",
    annotations: {
      title: "Find stranded gas across chains",
      readOnlyHint: true,
      openWorldHint: true,
    },
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
      "Price out emptying a chain's native gas balance to exactly zero: how much actually " +
      "arrives, the full fee breakdown, and whether the balance is even large enough to be " +
      "worth recovering. Call this before sweeping so the user sees the numbers first. Returns " +
      "a quote ID; quotes expire after about 60 seconds.",
    annotations: {
      title: "Quote emptying a chain",
      readOnlyHint: true,
      openWorldHint: true,
    },
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
      }>(`/quote?fromChainId=${fromChainId}&toChainId=${toChainId}&userAddress=${encodeURIComponent(userAddress)}&destination=${encodeURIComponent(destination)}`);

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
      "Check how a previously submitted sweep is progressing. Returns the current status " +
      "(pending, simulating, executing, bridging, completed, failed), the transaction hash once " +
      "there is one, and the error message if it failed.",
    annotations: {
      title: "Check sweep status",
      readOnlyHint: true,
      openWorldHint: true,
    },
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
      }>(`/sweep/${sweepId}`);

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
      "List past sweeps for a wallet address, with status and amounts. Useful for confirming a " +
      "chain was already emptied before trying again.",
    annotations: {
      title: "List past sweeps",
      readOnlyHint: true,
      openWorldHint: true,
    },
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

// ============ Tool: Register API Key ============

server.registerTool(
  "zerodust_register_api_key",
  {
    description:
      "Issue this agent its own ZeroDust API key for higher rate limits, with no human signup " +
      "step. The read-only tools work without a key, so only call this when rate limits are " +
      "actually being hit, or when setting up an unattended agent that will run repeatedly. " +
      "The key is returned once and is not stored by this server - report it to the operator " +
      "so they can set ZERODUST_API_KEY.",
    annotations: {
      title: "Get an API key for this agent",
      readOnlyHint: false,
      // Creates a credential, but destroys nothing and touches no funds.
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      name: z
        .string()
        .min(3)
        .max(100)
        .describe("Human-readable name for this agent, e.g. 'arbitrage-bot-prod'"),
      agentId: z
        .string()
        .max(255)
        .optional()
        .describe("Stable unique identifier for this agent, if it has one"),
      contactEmail: z
        .string()
        .email()
        .optional()
        .describe("Contact email for support and abuse notices"),
    },
  },
  async ({ name, agentId, contactEmail }) => {
    try {
      const body: Record<string, string> = { name };
      if (agentId) body.agentId = agentId;
      if (contactEmail) body.contactEmail = contactEmail;

      const data = await apiRequest<{
        apiKey: string;
        keyPrefix: string;
        keyType: string;
        rateLimits?: { perMinute: number; daily: number };
      }>("/agent/register", { method: "POST", body });

      return {
        content: [
          {
            type: "text" as const,
            text: [
              "API key issued. It is shown once and is not stored by this server.",
              "",
              `  ZERODUST_API_KEY=${data.apiKey}`,
              "",
              `Key type: ${data.keyType}`,
              data.rateLimits
                ? `Rate limits: ${data.rateLimits.perMinute}/minute, ${data.rateLimits.daily}/day`
                : null,
              "",
              "Give this to the operator to add to the server environment. Treat it as a",
              "secret: it raises rate limits, it does not authorise moving funds.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error registering API key: ${error instanceof Error ? error.message : String(error)}`,
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
      "Explain how a native gas balance can be emptied to exactly zero, what it costs, and how " +
      "to set this server up to do it. Call this when asked how ZeroDust works, why a full " +
      "balance normally cannot be sent, or what sweeping will cost.",
    annotations: {
      title: "How ZeroDust works",
      readOnlyHint: true,
      openWorldHint: false,
    },
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
            "  - Under $1: 5% service fee, no minimum",
            "  - From $1: 1% service fee (min $0.05, max $0.50)",
            "  - Gas costs: Paid by relayer, reimbursed from swept amount",
            "  - Users always receive the quoted amount or more",
            "",
            "Supported chains:",
            "  25 EVM chains with EIP-7702 support. Call zerodust_get_chains for the",
            "  authoritative live list rather than relying on any written-down count.",
            "",
            "Integration:",
            "  - SDK: npm install @zerodust/sdk viem",
            "  - API: GET /quote, POST /authorization, POST /sweep, GET /sweep/:id",
            "  - MCP: this server (stdio), or https://api.zerodust.xyz/mcp (no install)",
            "",
            "Trying it safely:",
            "  Every sweep tool accepts dryRun=true. That fetches a real quote and",
            "  produces the real signatures, then stops before submitting, so an",
            "  integration can be proven end to end without moving any funds.",
            "",
            "Sweeping from this MCP server:",
            "  The zerodust_sweep and zerodust_sweep_all tools are always listed, but",
            "  refuse to move funds unless ZERODUST_ALLOW_EXECUTE=true and a signing",
            "  key are both configured. A key may be supplied four ways:",
            "    ZERODUST_SIGNER_MODULE     module returning a viem LocalAccount,",
            "                               which is how Turnkey, Privy and KMS are used",
            "    ZERODUST_KEYSTORE_FILE     encrypted V3 keystore + password file",
            "    ZERODUST_PRIVATE_KEY_FILE  hex key in a file, not in the config",
            "    ZERODUST_PRIVATE_KEY       hex key inline",
            "  Funds may only be sent to the agent's own address unless",
            "  ZERODUST_ALLOWED_DESTINATIONS lists more.",
            "",
            "Rate limits:",
            "  The read-only tools work with no credential at all. For higher limits an",
            "  agent can issue itself an API key with zerodust_register_api_key, with no",
            "  human signup step, then pass it as ZERODUST_API_KEY.",
          ].join("\n"),
        },
      ],
    };
  }
);

// ============ Start Server ============

/**
 * The server instance with every read-only tool registered.
 *
 * Exported so tests can attach the execution tools and introspect the real tool
 * surface over an in-memory transport, rather than asserting against a copy of
 * the tool list that could drift from what agents actually see.
 */
export { server };

async function main() {
  const executeConfig = readExecuteConfig();
  // Registered unconditionally: when executeConfig is null the sweep tools are
  // visible but every handler refuses, so agents and directories can discover
  // the real tool surface without the server granting any spend capability.
  registerExecuteTools(server, executeConfig);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    executeConfig
      ? `ZeroDust MCP Server running on stdio (sweep execution ENABLED via ${executeConfig.signer.description})`
      : "ZeroDust MCP Server running on stdio (sweep tools listed but DISABLED; set " +
          "ZERODUST_ALLOW_EXECUTE=true plus one of ZERODUST_SIGNER_MODULE, " +
          "ZERODUST_KEYSTORE_FILE, ZERODUST_PRIVATE_KEY_FILE or ZERODUST_PRIVATE_KEY to enable)"
  );
}

/**
 * True when this module is the process entry point rather than an import.
 *
 * The realpath resolution is load-bearing, not defensive. npm installs a `bin`
 * as a **symlink** (`node_modules/.bin/zerodust-mcp` ->
 * `../@zerodust/mcp-server/dist/index.js`), so `process.argv[1]` is the symlink
 * path while `import.meta.url` is the resolved target. Comparing them raw makes
 * this false for every real invocation — `npx @zerodust/mcp-server` and every
 * MCP client — and the server silently never starts. Version 0.3.0 shipped
 * exactly that bug.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;

  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    // argv[1] may not exist on disk (some runners pass a virtual path). Falling
    // back to the unresolved comparison is still better than crashing.
    return import.meta.url === pathToFileURL(entry).href;
  }
}

// Importing this module — which the tests do — must not take over stdio.
if (isEntryPoint()) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
