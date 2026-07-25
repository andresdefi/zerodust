/**
 * @fileoverview Tests for the tool surface agents actually see
 *
 * These assert against a real MCP `tools/list` over an in-memory transport, not
 * against a hand-maintained list, so they fail if a tool is renamed, loses its
 * annotations, or drops a parameter.
 *
 * The annotations matter for adoption, not just correctness: clients use
 * readOnlyHint to decide what can run without a permission prompt. If a read
 * tool silently loses that hint it stops being called during exploration, and
 * exploration is how the stranded-balance problem gets noticed at all.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "../src/index.js";
import { registerExecuteTools } from "../src/execute.js";

type ListedTool = {
  name: string;
  description?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    title?: string;
  };
  inputSchema: { properties?: Record<string, unknown>; required?: string[] };
};

const READ_TOOLS = [
  "zerodust_get_chains",
  "zerodust_get_balances",
  "zerodust_get_quote",
  "zerodust_get_sweep_status",
  "zerodust_list_sweeps",
  "zerodust_info",
];

const SWEEP_TOOLS = ["zerodust_sweep", "zerodust_sweep_all"];

let tools: ListedTool[];

function byName(name: string): ListedTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return tool;
}

beforeAll(async () => {
  // Register the execute tools with no config, exactly as a server started with
  // no environment does.
  registerExecuteTools(server, null);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  tools = (await client.listTools()).tools as unknown as ListedTool[];
});

describe("tool surface", () => {
  it("registers every read tool", () => {
    for (const name of READ_TOOLS) {
      expect(tools.map((t) => t.name)).toContain(name);
    }
  });

  it("lists the sweep tools even with execution disabled", () => {
    // Hiding them protects nothing (the env vars are the real gate) and stops an
    // agent from telling the user how to turn sweeping on.
    for (const name of SWEEP_TOOLS) {
      expect(tools.map((t) => t.name)).toContain(name);
    }
  });

  it("exposes the self-service API key tool", () => {
    expect(tools.map((t) => t.name)).toContain("zerodust_register_api_key");
  });

  it("uses the zerodust_ prefix on every tool", () => {
    // The hosted server at api.zerodust.xyz/mcp shares these names. A tool
    // renamed here without renaming it there splits the vocabulary again.
    for (const tool of tools) {
      expect(tool.name).toMatch(/^zerodust_/);
    }
  });
});

describe("annotations", () => {
  it("marks every read tool readOnly", () => {
    for (const name of READ_TOOLS) {
      expect(byName(name).annotations?.readOnlyHint, `${name} readOnlyHint`).toBe(true);
    }
  });

  it("marks no read tool destructive", () => {
    for (const name of READ_TOOLS) {
      expect(byName(name).annotations?.destructiveHint, `${name} destructiveHint`).not.toBe(true);
    }
  });

  it("marks every sweep tool destructive and not readOnly", () => {
    for (const name of SWEEP_TOOLS) {
      expect(byName(name).annotations?.destructiveHint, `${name} destructiveHint`).toBe(true);
      expect(byName(name).annotations?.readOnlyHint, `${name} readOnlyHint`).toBe(false);
    }
  });

  it("gives every tool a human-readable title", () => {
    for (const tool of tools) {
      expect(tool.annotations?.title, `${tool.name} title`).toBeTruthy();
    }
  });
});

describe("descriptions", () => {
  it("states the impossibility on the balance tool rather than just \"check balances\"", () => {
    // This is the claim an agent matches a frustrated user against. Without it
    // the tool is indistinguishable from every other balance reader.
    const description = byName("zerodust_get_balances").description ?? "";

    expect(description).toMatch(/cannot transfer 100%/i);
    expect(description).toMatch(/stranded|leftover/i);
  });

  it("carries the vocabulary users actually use, across the sweep tools", () => {
    const combined = SWEEP_TOOLS.map((n) => byName(n).description ?? "")
      .join(" ")
      .toLowerCase();

    for (const term of ["close out", "wind down", "decommission", "leftover", "exactly zero"]) {
      expect(combined, `missing vocabulary: ${term}`).toContain(term);
    }
  });

  it("tells the reader how to enable sweeping, on every sweep tool", () => {
    for (const name of SWEEP_TOOLS) {
      expect(byName(name).description).toContain("ZERODUST_ALLOW_EXECUTE=true");
    }
  });

  it("advertises dryRun on every sweep tool description", () => {
    for (const name of SWEEP_TOOLS) {
      expect(byName(name).description).toMatch(/dryRun/);
    }
  });
});

describe("sweep tool schemas", () => {
  it("accepts dryRun on both sweep tools", () => {
    for (const name of SWEEP_TOOLS) {
      expect(byName(name).inputSchema.properties, `${name} properties`).toHaveProperty("dryRun");
    }
  });

  it("does not require dryRun, so the default stays a real sweep", () => {
    for (const name of SWEEP_TOOLS) {
      expect(byName(name).inputSchema.required ?? []).not.toContain("dryRun");
    }
  });

  it("makes destination optional so the default is the agent's own address", () => {
    for (const name of SWEEP_TOOLS) {
      expect(byName(name).inputSchema.required ?? []).not.toContain("destination");
    }
  });
});

describe("with execution disabled", () => {
  it("refuses to sweep and explains every way to enable it", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-call", version: "1.0.0" });
    // A second server instance, so this call does not depend on the shared one.
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const isolated = new McpServer({ name: "zerodust-test", version: "0.0.0" });
    registerExecuteTools(isolated, null);

    await Promise.all([client.connect(clientTransport), isolated.connect(serverTransport)]);

    const result = (await client.callTool({
      name: "zerodust_sweep",
      arguments: { fromChainId: 42161, toChainId: 8453 },
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    const message = result.content[0]?.text ?? "";
    expect(message).toContain("nothing was moved");
    expect(message).toContain("ZERODUST_SIGNER_MODULE");
    expect(message).toContain("ZERODUST_KEYSTORE_FILE");
    expect(message).toContain("ZERODUST_PRIVATE_KEY_FILE");
  });
});
