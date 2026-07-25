/**
 * @fileoverview Execution tools for the ZeroDust MCP server
 *
 * The read-only tools in `index.ts` let an agent observe balances and quotes.
 * This module adds the tools that actually perform a sweep, which requires a
 * signing key and is therefore opt-in.
 *
 * Execution is disabled unless BOTH of these are true:
 *   ZERODUST_ALLOW_EXECUTE=true  - explicit acknowledgement that funds can move
 *   a signing key is configured  - see signer.ts for the four accepted forms
 *
 * Optional:
 *   ZERODUST_ALLOWED_DESTINATIONS - comma-separated address allowlist.
 *     When unset, the only permitted destination is the agent's own address.
 *
 * The allowlist is the main defence against prompt injection: an agent that is
 * talked into sweeping somewhere it shouldn't still cannot send funds to an
 * address the operator never approved.
 *
 * Every sweep tool also accepts `dryRun`, which runs the whole flow and stops
 * before submission. That exists because there is no testnet backend to point
 * at, so without it the only way to evaluate ZeroDust is to move real money.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { hasSignerEnv, resolveSignerSource, type SignerSource } from "./signer.js";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

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
  /** Where the signing key comes from. Resolved lazily, on first use. */
  signer: SignerSource;
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
  const allowExecute = env.ZERODUST_ALLOW_EXECUTE?.trim() === "true";
  const signerConfigured = hasSignerEnv(env);

  if (!signerConfigured && !allowExecute) return null;

  if (!allowExecute) {
    throw new Error(
      "A ZeroDust signing key is configured but ZERODUST_ALLOW_EXECUTE is not \"true\". " +
        "Sweeping moves real funds, so it must be enabled explicitly."
    );
  }
  if (!signerConfigured) {
    throw new Error(
      "ZERODUST_ALLOW_EXECUTE is \"true\" but no signing key is configured. Set exactly one of:\n" +
        "  ZERODUST_SIGNER_MODULE     module returning a viem LocalAccount (Turnkey, Privy, KMS, ...)\n" +
        "  ZERODUST_KEYSTORE_FILE     encrypted V3 keystore, with ZERODUST_KEYSTORE_PASSWORD_FILE\n" +
        "  ZERODUST_PRIVATE_KEY_FILE  file containing a hex private key\n" +
        "  ZERODUST_PRIVATE_KEY       hex private key inline"
    );
  }

  // Throws on a partial or ambiguous signer setup.
  const signer = resolveSignerSource(env)!;

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
    signer,
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
  " Requires ZERODUST_ALLOW_EXECUTE=true plus a signing key; without them this tool returns an " +
  "error and moves no funds. Pass dryRun=true to rehearse the whole flow without moving anything.";

const DISABLED_MESSAGE = [
  "Sweep execution is disabled on this ZeroDust MCP server, so nothing was moved.",
  "",
  "To enable it, restart the server with ZERODUST_ALLOW_EXECUTE=true and exactly",
  "one signing key:",
  "",
  "  ZERODUST_SIGNER_MODULE=./my-signer.js",
  "      A module whose default export returns a viem LocalAccount. This is how",
  "      you use Turnkey, Privy, AWS KMS or any other custody service without",
  "      putting a raw key anywhere.",
  "",
  "  ZERODUST_KEYSTORE_FILE=./agent-keystore.json",
  "  ZERODUST_KEYSTORE_PASSWORD_FILE=./agent-keystore.pass",
  "      An encrypted V3 keystore, as produced by `cast wallet import` or geth.",
  "",
  "  ZERODUST_PRIVATE_KEY_FILE=./agent.key",
  "      A file containing a hex private key, so the key stays out of configs.",
  "",
  "  ZERODUST_PRIVATE_KEY=0x...",
  "      A hex key inline. Simplest, and the least private of the four.",
  "",
  "Optionally set ZERODUST_ALLOWED_DESTINATIONS to permit sweeping to addresses",
  "other than the agent's own. The read-only tools (balances, quotes, status)",
  "work without any of this.",
].join("\n");

/** Shared shape of the dryRun parameter, so both sweep tools describe it identically. */
const dryRunSchema = z
  .boolean()
  .optional()
  .describe(
    "Rehearse without moving funds (default false). Fetches a real quote and produces " +
      "the real signatures, then stops before submitting. Use this to prove the setup " +
      "works before sweeping a real balance."
  );

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
  // The agent is constructed lazily so a bad key or an unreachable remote
  // signer surfaces on first use with a clear message, rather than crashing the
  // whole server at startup.
  let agentPromise: Promise<import("@zerodust/sdk").ZeroDustAgent> | null = null;

  async function getAgent(enabled: ExecuteConfig) {
    if (!agentPromise) {
      agentPromise = (async () => {
        const [{ ZeroDustAgent }, account] = await Promise.all([
          import("@zerodust/sdk"),
          enabled.signer.load(),
        ]);
        return new ZeroDustAgent({ account, environment: "mainnet" });
      })();
      // A failed load must not be cached, or a transient signer outage would
      // wedge the server until restart.
      agentPromise.catch(() => {
        agentPromise = null;
      });
    }
    return agentPromise;
  }

  const disabled = () => text(DISABLED_MESSAGE, true);

  server.registerTool(
    "zerodust_get_agent_address",
    {
      description:
        "Show which wallet this ZeroDust server signs with, where its key comes from, and " +
        "which destinations it is allowed to sweep to. Call this before any sweep to confirm " +
        "the right wallet is about to be emptied." +
        GATE_NOTE,
      annotations: {
        title: "Show the signing wallet",
        readOnlyHint: true,
        openWorldHint: false,
      },
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
            `Signing key: ${config.signer.description}`,
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
        "Empty one chain completely: move 100% of the native gas token off it and leave the " +
        "balance at exactly zero. This is the operation an ordinary transfer cannot do, because " +
        "sending the gas token requires keeping some gas token back to pay for the send. Use " +
        "when the goal is to close out, wind down, decommission or fully exit a chain, or to " +
        "recover a leftover or stranded balance that is too small to move normally. Moves real " +
        "funds. Call zerodust_get_quote first to show the user what they will receive." +
        GATE_NOTE,
      annotations: {
        title: "Empty a chain to exactly zero",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        fromChainId: z.number().int().positive().describe("Chain to empty"),
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
        dryRun: dryRunSchema,
      },
    },
    async ({ fromChainId, toChainId, destination, dryRun }) => {
      if (!config) return disabled();
      try {
        const agent = await getAgent(config);
        const target = destination ?? agent.address;

        const denial = checkDestination(target, agent.address, config.allowedDestinations);
        if (denial) return text(denial, true);

        const result = await agent.sweep(
          {
            fromChainId,
            toChainId,
            destination: target as `0x${string}`,
          },
          dryRun ? { dryRun: true } : {}
        );

        if (!result.success) {
          return text(`Sweep failed: ${result.error ?? "unknown error"}`, true);
        }

        if (result.dryRun) {
          return text(
            [
              `Dry run only - nothing was submitted and chain ${fromChainId} is untouched.`,
              `Would send to: ${target} (chain ${toChainId})`,
              result.quote
                ? `Current balance: ${result.quote.userBalance} wei`
                : null,
              result.quote
                ? `Would receive: ${result.quote.estimatedReceive} wei`
                : null,
              `Signatures produced: intent, delegation, revoke (all valid, none broadcast)`,
              `Re-run without dryRun to execute for real.`,
            ]
              .filter(Boolean)
              .join("\n")
          );
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
        "Empty every chain that still holds a native gas balance, consolidating all of it onto " +
        "one destination chain and leaving each source at exactly zero. Use when the goal is to " +
        "clean up a wallet across chains, collect scattered leftover gas, or retire a wallet " +
        "entirely. Moves real funds across multiple chains. Call zerodust_get_balances first to " +
        "show the user what will be swept." +
        GATE_NOTE,
      annotations: {
        title: "Empty every chain with a balance",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
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
        dryRun: dryRunSchema,
      },
    },
    async ({ toChainId, destination, dryRun }) => {
      if (!config) return disabled();
      try {
        const agent = await getAgent(config);
        const target = destination ?? agent.address;

        const denial = checkDestination(target, agent.address, config.allowedDestinations);
        if (denial) return text(denial, true);

        const result = await agent.sweepAll(
          {
            toChainId,
            destination: target as `0x${string}`,
          },
          dryRun ? { dryRun: true } : {}
        );

        const summary = result.results
          .map((sweep) => {
            if (!sweep.success) {
              return `  chain ${sweep.fromChainId}: failed - ${sweep.error ?? "unknown error"}`;
            }
            if (sweep.dryRun) {
              const receive = sweep.quote ? ` (would receive ${sweep.quote.estimatedReceive} wei)` : "";
              return `  chain ${sweep.fromChainId}: would sweep${receive}`;
            }
            return `  chain ${sweep.fromChainId}: swept${sweep.txHash ? ` (${sweep.txHash})` : ""}`;
          })
          .join("\n");

        const headline = dryRun
          ? `Dry run only - nothing was submitted. ${result.successful}/${result.total} chains would sweep to ${target} on chain ${toChainId}.`
          : `Swept ${result.successful}/${result.total} chains to ${target} on chain ${toChainId}.`;

        return text(
          [headline, summary, dryRun ? "Re-run without dryRun to execute for real." : null]
            .filter(Boolean)
            .join("\n")
        );
      } catch (error) {
        return errorText("Error executing batch sweep", error);
      }
    }
  );
}
