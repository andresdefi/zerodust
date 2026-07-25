/**
 * @fileoverview Tests that the published binary actually starts
 *
 * These exist because 0.3.0 shipped a server that did not start at all when
 * invoked the way every real user invokes it.
 *
 * The entry-point guard compared `import.meta.url` to `process.argv[1]` raw. npm
 * installs a `bin` as a **symlink**, so argv[1] is the symlink path while
 * import.meta.url is the resolved target. They never matched, `main()` never
 * ran, and the process exited silently having printed nothing. Every unit test
 * passed, because they all import the module rather than spawning it — which is
 * precisely the case the guard exists to handle.
 *
 * So these tests spawn the built artifact as a subprocess, including through a
 * symlink. They need `dist/`, so they skip with a clear message if it is absent.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(PKG_ROOT, "dist", "index.js");

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "binary-test", version: "1.0.0" },
  },
};

const TOOLS_LIST = { jsonrpc: "2.0", id: 2, method: "tools/list" };

/**
 * Runs the server at `command`, writes the requests, and resolves with the
 * parsed JSON-RPC responses.
 */
function runServer(command: string, requests: unknown[]): Promise<{
  responses: Record<string, unknown>[];
  stderr: string;
  code: number | null;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [command], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out; stdout=${JSON.stringify(stdout)} stderr=${stderr}`));
    }, 20000);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      const responses = stdout
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      resolve({ responses, stderr, code });
    });

    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
    child.stdin.end();
  });
}

const built = existsSync(ENTRY);

describe.skipIf(!built)("published binary", () => {
  beforeAll(() => {
    if (!built) return;
  });

  it("starts and answers initialize when run by direct path", async () => {
    const { responses } = await runServer(ENTRY, [INITIALIZE]);

    const initialize = responses.find((r) => r.id === 1);
    expect(initialize, "no response to initialize").toBeDefined();
    expect((initialize?.result as { serverInfo: { name: string } }).serverInfo.name).toBe(
      "zerodust"
    );
  });

  it("starts when invoked through a symlink, as npm's bin does", async () => {
    // This is the case that broke 0.3.0. npm links
    // node_modules/.bin/zerodust-mcp -> ../@zerodust/mcp-server/dist/index.js,
    // so argv[1] is the link and import.meta.url is the target.
    const dir = mkdtempSync(join(tmpdir(), "zerodust-bin-"));
    const link = join(dir, "zerodust-mcp");
    symlinkSync(ENTRY, link);

    const { responses, stderr } = await runServer(link, [INITIALIZE]);

    const initialize = responses.find((r) => r.id === 1);
    expect(
      initialize,
      `server produced no response when run via symlink. stderr=${stderr}`
    ).toBeDefined();
    expect((initialize?.result as { serverInfo: { name: string } }).serverInfo.name).toBe(
      "zerodust"
    );
  });

  it("announces itself on stderr so a client can see it came up", async () => {
    const { stderr } = await runServer(ENTRY, [INITIALIZE]);

    expect(stderr).toContain("ZeroDust MCP Server running on stdio");
  });

  it("lists the full tool surface over a real stdio session", async () => {
    const { responses } = await runServer(ENTRY, [
      INITIALIZE,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      TOOLS_LIST,
    ]);

    const list = responses.find((r) => r.id === 2);
    const tools = (list?.result as { tools: Array<{ name: string }> }).tools;

    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "zerodust_get_balances",
        "zerodust_get_quote",
        "zerodust_sweep",
        "zerodust_sweep_all",
        "zerodust_register_api_key",
      ])
    );
  });

  it("negotiates the current protocol version", async () => {
    const { responses } = await runServer(ENTRY, [INITIALIZE]);

    const initialize = responses.find((r) => r.id === 1);
    expect((initialize?.result as { protocolVersion: string }).protocolVersion).toBe(
      "2025-06-18"
    );
  });
});

// A missing dist is not a pass. Make the skip visible rather than silent.
describe.skipIf(built)("published binary (skipped)", () => {
  it("requires a build - run `npm run build` before these tests are meaningful", () => {
    expect(built).toBe(false);
  });
});
