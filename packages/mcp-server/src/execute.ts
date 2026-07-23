/**
 * @fileoverview Execution tools for the ZeroDust MCP server
 *
 * The read-only tools in `index.ts` let an agent observe balances and quotes.
 * This module adds the tools that actually perform a sweep, which requires a
 * signing key and is therefore opt-in.
 *
 * Execution is disabled unless BOTH of these are set:
 *   ZERODUST_PRIVATE_KEY   - hex private key for the agent's own wallet
 *   ZERODUST_ALLOW_EXECUTE - must be exactly "true"
 *
 * Optional:
 *   ZERODUST_ALLOWED_DESTINATIONS - comma-separated address allowlist.
 *     When unset, the only permitted destination is the agent's own address.
 *
 * The allowlist is the main defence against prompt injection: an agent that is
 * talked into sweeping somewhere it shouldn't still cannot send funds to an
 * address the operator never approved.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const PRIVATE_KEY_RE = /^0x[a-fA-F0-9]{64}$/;

type TextResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function text(body: string, isError = false): TextResult {
  const result: TextResult = { content: [{ type: "text" as const, text: body }] };
  if (isError) result.isError = true;
  return result;
}

function errorText(prefix: string, error: unknown): TextResult {
  return text(`${prefix}: ${error instanceof Error ? error.message : String(error)}`, true);
}

/** Resolved execution configuration, or null when execution is not enabled. */
export interface ExecuteConfig {
  privateKey: `0x${string}`;
  /** Lowercased allowlist. Empty means "agent's own address only". */
  allowedDestinations: string[];
}

/**
 * Reads execution settings from the environment.
 *
 * Returns null when execution is not enabled, and throws when it is enabled but
 * misconfigured — a silently disabled sweep tool is worse than a startup error,
 * because the agent discovers it only mid-task.
 */
export function readExecuteConfig(env: NodeJS.ProcessEnv = process.env): ExecuteConfig | null {
  const privateKey = env.ZERODUST_PRIVATE_KEY?.trim();
  const allowExecute = env.ZERODUST_ALLOW_EXECUTE?.trim() === "true";

  if (!privateKey && !allowExecute) return null;

  if (!allowExecute) {
    throw new Error(
      "ZERODUST_PRIVATE_KEY is set but ZERODUST_ALLOW_EXECUTE is not \"true\". " +
        "Sweeping moves real funds, so it must be enabled explicitly."
    );
  }
  if (!privateKey) {
    throw new Error("ZERODUST_ALLOW_EXECUTE is \"true\" but ZERODUST_PRIVATE_KEY is not set.");
  }

  const normalizedKey = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`;
  if (!PRIVATE_KEY_RE.test(normalizedKey)) {
    throw new Error("ZERODUST_PRIVATE_KEY must be a 32-byte hex private key.");
  }

  const allowedDestinations = (env.ZERODUST_ALLOWED_DESTINATIONS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of allowedDestinations) {
    if (!ADDRESS_RE.test(entry)) {
      throw new Error(`ZERODUST_ALLOWED_DESTINATIONS contains an invalid address: ${entry}`);
    }
  }

  return {
    privateKey: normalizedKey,
    allowedDestinations: allowedDestinations.map((entry) => entry.toLowerCase()),
  };
}

/**
 * Checks a requested destination against the allowlist.
 *
 * @returns an error message when the destination is not permitted, otherwise null
 */
export function checkDestination(
  destination: string,
  agentAddress: string,
  allowedDestinations: string[]
): string | null {
  const target = destination.toLowerCase();

  if (target === agentAddress.toLowerCase()) return null;
  if (allowedDestinations.includes(target)) return null;

  if (allowedDestinations.length === 0) {
    return (
      `Destination ${destination} is not permitted. Only the agent's own address ` +
      `(${agentAddress}) is allowed. To sweep elsewhere, set ZERODUST_ALLOWED_DESTINATIONS.`
    );
  }
  return (
    `Destination ${destination} is not in ZERODUST_ALLOWED_DESTINATIONS. ` +
    `Permitted: ${agentAddress} (own address), ${allowedDestinations.join(", ")}.`
  );
}

/** Suffix appended to every sweep tool description so the gate is self-documenting. */
const GATE_NOTE =
  " Requires ZERODUST_ALLOW_EXECUTE=true and ZERODUST_PRIVATE_KEY; without them this tool returns an error and moves no funds.";

const DISABLED_MESSAGE = [
  "Sweep execution is disabled on this ZeroDust MCP server, so nothing was moved.",
  "",
  "To enable it, restart the server with both:",
  "  ZERODUST_ALLOW_EXECUTE=true",
  "  ZERODUST_PRIVATE_KEY=0x...   (the agent's own wallet)",
  "",
  "Optionally set ZERODUST_ALLOWED_DESTINATIONS to permit sweeping to addresses",
  "other than the agent's own. The read-only tools (balances, quotes, status)",
  "work without any of this.",
].join("\n");

/**
 * Registers the sweep-execution tools on an MCP server.
 *
 * Pass the result of {@link readExecuteConfig}, including null. The tools are
 * registered either way: an agent has to be able to *see* that sweeping exists
 * in order to tell the user how to turn it on, and a directory that introspects
 * the server with no environment set should still discover the real tool
 * surface. When config is null every handler refuses before touching a key, so
 * advertising the tool grants no capability.
 */
export function registerExecuteTools(server: McpServer, config: ExecuteConfig | null): void {
  // The agent is constructed lazily so a bad key surfaces on first use with a
  // clear message, rather than crashing the whole server at startup.
  let agentPromise: Promise<import("@zerodust/sdk").ZeroDustAgent> | null = null;

  async function getAgent(enabled: ExecuteConfig) {
    if (!agentPromise) {
      agentPromise = import("@zerodust/sdk").then(({ createAgentFromPrivateKey }) =>
        createAgentFromPrivateKey(enabled.privateKey, { environment: "mainnet" })
      );
    }
    return agentPromise;
  }

  const disabled = () => text(DISABLED_MESSAGE, true);

  server.registerTool(
    "zerodust_get_agent_address",
    {
      description:
        "Get the wallet address this ZeroDust MCP server signs with, plus which sweep destinations are permitted. Use before sweeping to confirm which wallet will be swept." +
        GATE_NOTE,
      inputSchema: {},
    },
    async () => {
      if (!config) return disabled();
      try {
        const agent = await getAgent(config);
        const allowed =
          config.allowedDestinations.length === 0
            ? "own address only"
            : `own address, ${config.allowedDestinations.join(", ")}`;
        return text(
          [
            `Agent address: ${agent.address}`,
            `Execution: enabled`,
            `Permitted destinations: ${allowed}`,
          ].join("\n")
        );
      } catch (error) {
        return errorText("Error resolving agent address", error);
      }
    }
  );

  server.registerTool(
    "zerodust_sweep",
    {
      description:
        "Sweep 100% of the native gas token from one chain, leaving exactly zero balance. Moves real funds. Call zerodust_get_quote first to show the user what they will receive." +
        GATE_NOTE,
      inputSchema: {
        fromChainId: z.number().int().positive().describe("Chain to sweep from"),
        toChainId: z
          .number()
          .int()
          .positive()
          .describe("Chain to receive funds on (same as fromChainId for a same-chain sweep)"),
        destination: z
          .string()
          .regex(ADDRESS_RE)
          .optional()
          .describe("Destination address (defaults to the agent's own address)"),
      },
    },
    async ({ fromChainId, toChainId, destination }) => {
      if (!config) return disabled();
      try {
        const agent = await getAgent(config);
        const target = destination ?? agent.address;

        const denial = checkDestination(target, agent.address, config.allowedDestinations);
        if (denial) return text(denial, true);

        const result = await agent.sweep({
          fromChainId,
          toChainId,
          destination: target as `0x${string}`,
        });

        if (!result.success) {
          return text(`Sweep failed: ${result.error ?? "unknown error"}`, true);
        }

        const lines = [
          `Sweep complete. Chain ${fromChainId} balance is now exactly zero.`,
          `Sweep ID: ${result.sweepId}`,
          `Destination: ${target} (chain ${toChainId})`,
        ];
        if (result.txHash) lines.push(`Transaction: ${result.txHash}`);
        return text(lines.join("\n"));
      } catch (error) {
        return errorText("Error executing sweep", error);
      }
    }
  );

  server.registerTool(
    "zerodust_sweep_all",
    {
      description:
        "Sweep every chain that holds a sweepable balance, consolidating to one destination chain. Moves real funds across multiple chains. Call zerodust_get_balances first to show the user what will be swept." +
        GATE_NOTE,
      inputSchema: {
        toChainId: z
          .number()
          .int()
          .positive()
          .describe("Chain to consolidate all funds onto"),
        destination: z
          .string()
          .regex(ADDRESS_RE)
          .optional()
          .describe("Destination address (defaults to the agent's own address)"),
      },
    },
    async ({ toChainId, destination }) => {
      if (!config) return disabled();
      try {
        const agent = await getAgent(config);
        const target = destination ?? agent.address;

        const denial = checkDestination(target, agent.address, config.allowedDestinations);
        if (denial) return text(denial, true);

        const result = await agent.sweepAll({
          toChainId,
          destination: target as `0x${string}`,
        });

        const summary = result.results
          .map((sweep) =>
            sweep.success
              ? `  chain ${sweep.fromChainId}: swept${sweep.txHash ? ` (${sweep.txHash})` : ""}`
              : `  chain ${sweep.fromChainId}: failed - ${sweep.error ?? "unknown error"}`
          )
          .join("\n");

        return text(
          [
            `Swept ${result.successful}/${result.total} chains to ${target} on chain ${toChainId}.`,
            summary,
          ]
            .filter(Boolean)
            .join("\n")
        );
      } catch (error) {
        return errorText("Error executing batch sweep", error);
      }
    }
  );
}
