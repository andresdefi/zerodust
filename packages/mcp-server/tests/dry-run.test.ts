/**
 * @fileoverview Tests that dryRun actually reaches the SDK
 *
 * The tool-surface tests prove `dryRun` is *advertised*. That is not the
 * dangerous part. The dangerous part is the wiring: if the flag is accepted and
 * then dropped on the way to the SDK, an agent that asked to rehearse performs a
 * real, irreversible sweep instead, and every other test still passes.
 *
 * So these tests stub the SDK and assert on the options it is handed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createSignerFixtures, TEST_ADDRESS } from "./helpers/signer-fixtures.js";

// Generated rather than committed - see helpers/signer-fixtures.ts.
const fixtures = createSignerFixtures();
const AGENT_ADDRESS = TEST_ADDRESS;

/** Records every call the tools make into the SDK. */
const calls: Array<{ method: "sweep" | "sweepAll"; request: unknown; options: unknown }> = [];
/** The config each agent was constructed with. */
const agentConfigs: unknown[] = [];

vi.mock("@zerodust/sdk", () => {
  class FakeAgent {
    address = AGENT_ADDRESS;

    constructor(config: unknown) {
      agentConfigs.push(config);
    }

    async sweep(request: unknown, options: unknown) {
      calls.push({ method: "sweep", request, options });
      const dryRun = Boolean((options as { dryRun?: boolean } | undefined)?.dryRun);
      return {
        success: true,
        ...(dryRun
          ? {
              dryRun: true,
              quote: { userBalance: "1000", estimatedReceive: "900" },
            }
          : { sweepId: "real-sweep-1", txHash: "0xreal" }),
      };
    }

    async sweepAll(options: unknown, sweepOptions: unknown) {
      calls.push({ method: "sweepAll", request: options, options: sweepOptions });
      const dryRun = Boolean((sweepOptions as { dryRun?: boolean } | undefined)?.dryRun);
      return {
        total: 1,
        successful: 1,
        failed: 0,
        results: [
          {
            success: true,
            fromChainId: 42161,
            toChainId: 8453,
            ...(dryRun
              ? { dryRun: true, quote: { estimatedReceive: "900" } }
              : { txHash: "0xreal" }),
          },
        ],
      };
    }
  }

  return { ZeroDustAgent: FakeAgent };
});

async function connectedClient(extraEnv: Record<string, string> = {}) {
  const { readExecuteConfig, registerExecuteTools } = await import("../src/execute.js");

  const config = readExecuteConfig({
    ZERODUST_SIGNER_MODULE: fixtures.signerModule,
    ZERODUST_ALLOW_EXECUTE: "true",
    ...extraEnv,
  });

  const server = new McpServer({ name: "zerodust-test", version: "0.0.0" });
  registerExecuteTools(server, config);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "dry-run-test", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return client;
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
}

function lastCall() {
  return calls[calls.length - 1]!;
}

describe("zerodust_sweep dryRun wiring", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("passes dryRun through to the SDK when requested", async () => {
    const client = await connectedClient();

    await client.callTool({
      name: "zerodust_sweep",
      arguments: { fromChainId: 42161, toChainId: 8453, dryRun: true },
    });

    expect(lastCall().method).toBe("sweep");
    expect(lastCall().options).toMatchObject({ dryRun: true });
  });

  it("does NOT set dryRun when it was not requested", async () => {
    const client = await connectedClient();

    await client.callTool({
      name: "zerodust_sweep",
      arguments: { fromChainId: 42161, toChainId: 8453 },
    });

    expect((lastCall().options as { dryRun?: boolean }).dryRun).toBeFalsy();
  });

  it("reports a dry run as a rehearsal, never as a completed sweep", async () => {
    const client = await connectedClient();

    const message = textOf(
      await client.callTool({
        name: "zerodust_sweep",
        arguments: { fromChainId: 42161, toChainId: 8453, dryRun: true },
      })
    );

    expect(message).toContain("Dry run only");
    expect(message).toContain("untouched");
    // Must not claim the balance is now zero - that would be a false report of
    // an irreversible action.
    expect(message).not.toContain("is now exactly zero");
  });

  it("reports a real sweep as complete", async () => {
    const client = await connectedClient();

    const message = textOf(
      await client.callTool({
        name: "zerodust_sweep",
        arguments: { fromChainId: 42161, toChainId: 8453 },
      })
    );

    expect(message).toContain("is now exactly zero");
    expect(message).toContain("real-sweep-1");
    expect(message).not.toContain("Dry run");
  });

  it("still enforces the destination allowlist during a dry run", async () => {
    const client = await connectedClient();

    const result = (await client.callTool({
      name: "zerodust_sweep",
      arguments: {
        fromChainId: 42161,
        toChainId: 8453,
        destination: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        dryRun: true,
      },
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    // Denied before reaching the SDK at all.
    expect(calls).toHaveLength(0);
  });
});

describe("zerodust_sweep_all dryRun wiring", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("passes dryRun through to the SDK when requested", async () => {
    const client = await connectedClient();

    await client.callTool({
      name: "zerodust_sweep_all",
      arguments: { toChainId: 8453, dryRun: true },
    });

    expect(lastCall().method).toBe("sweepAll");
    expect(lastCall().options).toMatchObject({ dryRun: true });
  });

  it("does NOT set dryRun when it was not requested", async () => {
    const client = await connectedClient();

    await client.callTool({
      name: "zerodust_sweep_all",
      arguments: { toChainId: 8453 },
    });

    expect((lastCall().options as { dryRun?: boolean }).dryRun).toBeFalsy();
  });

  it("labels each chain as would-sweep rather than swept", async () => {
    const client = await connectedClient();

    const message = textOf(
      await client.callTool({
        name: "zerodust_sweep_all",
        arguments: { toChainId: 8453, dryRun: true },
      })
    );

    expect(message).toContain("Dry run only");
    expect(message).toContain("would sweep");
    expect(message).not.toMatch(/chain 42161: swept/);
  });
});

describe("ZERODUST_RPC_URLS wiring", () => {
  it("hands the configured RPCs to the agent", async () => {
    agentConfigs.length = 0;
    const client = await connectedClient({ ZERODUST_RPC_URLS: "8453=https://base.example/rpc" });

    await client.callTool({
      name: "zerodust_sweep",
      arguments: { fromChainId: 8453, toChainId: 8453, dryRun: true },
    });

    expect(agentConfigs.at(-1)).toMatchObject({ rpcUrls: { 8453: "https://base.example/rpc" } });
  });
});
