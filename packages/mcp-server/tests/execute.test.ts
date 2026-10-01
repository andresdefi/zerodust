/**
 * @fileoverview Tests for the execution gate and destination allowlist
 *
 * These are the safety properties of the server. The gate decides whether funds
 * can move at all; the allowlist decides where they can go, and is the only
 * thing standing between a prompt-injected agent and someone else's address.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { checkDestination, parseRpcUrls, readExecuteConfig } from "../src/execute.js";
import { createSignerFixtures, TEST_KEY, type SignerFixtures } from "./helpers/signer-fixtures.js";

// Generated rather than committed - see helpers/signer-fixtures.ts.
let fixtures: SignerFixtures;

beforeAll(() => {
  fixtures = createSignerFixtures();
});
const OWN = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OTHER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const THIRD = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

describe("readExecuteConfig", () => {
  it("returns null for a plain read-only server", () => {
    expect(readExecuteConfig({})).toBeNull();
  });

  it("refuses a key without the explicit execute opt-in", () => {
    expect(() => readExecuteConfig({ ZERODUST_PRIVATE_KEY: TEST_KEY })).toThrow(
      /ZERODUST_ALLOW_EXECUTE is not "true"/
    );
  });

  it("treats any value other than \"true\" as not opted in", () => {
    expect(() =>
      readExecuteConfig({ ZERODUST_PRIVATE_KEY: TEST_KEY, ZERODUST_ALLOW_EXECUTE: "yes" })
    ).toThrow(/is not "true"/);
  });

  it("lists every signer option when the opt-in is set with no key", () => {
    // The error is the only documentation some operators will read, so it has
    // to name all four routes rather than just the inline key.
    expect(() => readExecuteConfig({ ZERODUST_ALLOW_EXECUTE: "true" })).toThrow(
      /ZERODUST_SIGNER_MODULE[\s\S]*ZERODUST_KEYSTORE_FILE[\s\S]*ZERODUST_PRIVATE_KEY_FILE/
    );
  });

  it("enables execution with an inline key", () => {
    const config = readExecuteConfig({
      ZERODUST_PRIVATE_KEY: TEST_KEY,
      ZERODUST_ALLOW_EXECUTE: "true",
    });

    expect(config?.signer.kind).toBe("key-env");
    expect(config?.allowedDestinations).toEqual([]);
  });

  it("enables execution with a keystore", () => {
    const config = readExecuteConfig({
      ZERODUST_KEYSTORE_FILE: fixtures.keystoreScrypt,
      ZERODUST_KEYSTORE_PASSWORD_FILE: fixtures.passwordFile,
      ZERODUST_ALLOW_EXECUTE: "true",
    });

    expect(config?.signer.kind).toBe("keystore");
  });

  it("enables execution with a signer module", () => {
    const config = readExecuteConfig({
      ZERODUST_SIGNER_MODULE: fixtures.signerModule,
      ZERODUST_ALLOW_EXECUTE: "true",
    });

    expect(config?.signer.kind).toBe("module");
  });

  it("lowercases the allowlist so comparison is case-insensitive", () => {
    const config = readExecuteConfig({
      ZERODUST_PRIVATE_KEY: TEST_KEY,
      ZERODUST_ALLOW_EXECUTE: "true",
      ZERODUST_ALLOWED_DESTINATIONS: `${OTHER}, ${THIRD}`,
    });

    expect(config?.allowedDestinations).toEqual([OTHER.toLowerCase(), THIRD.toLowerCase()]);
  });

  it("rejects a malformed address in the allowlist", () => {
    // Silently dropping a typo'd entry would deny a destination the operator
    // believes they permitted, mid-sweep.
    expect(() =>
      readExecuteConfig({
        ZERODUST_PRIVATE_KEY: TEST_KEY,
        ZERODUST_ALLOW_EXECUTE: "true",
        ZERODUST_ALLOWED_DESTINATIONS: `${OTHER},0xnope`,
      })
    ).toThrow(/invalid address: 0xnope/);
  });

  it("does not resolve the key at config time", () => {
    // A bad key must surface on first use with a clear message, not crash the
    // server at startup and take the read-only tools down with it.
    const config = readExecuteConfig({
      ZERODUST_PRIVATE_KEY: "0xdeadbeef",
      ZERODUST_ALLOW_EXECUTE: "true",
    });

    expect(config).not.toBeNull();
  });
});

describe("checkDestination", () => {
  it("always permits the agent's own address", () => {
    expect(checkDestination(OWN, OWN, [])).toBeNull();
  });

  it("permits the own address regardless of case", () => {
    expect(checkDestination(OWN.toLowerCase(), OWN, [])).toBeNull();
  });

  it("denies any third party when the allowlist is empty", () => {
    const denial = checkDestination(OTHER, OWN, []);

    expect(denial).toContain("is not permitted");
    expect(denial).toContain("ZERODUST_ALLOWED_DESTINATIONS");
  });

  it("permits an allowlisted address", () => {
    expect(checkDestination(OTHER, OWN, [OTHER.toLowerCase()])).toBeNull();
  });

  it("permits an allowlisted address given in a different case", () => {
    expect(checkDestination(OTHER.toUpperCase().replace("0X", "0x"), OWN, [OTHER.toLowerCase()])).toBeNull();
  });

  it("denies an address that is not on a non-empty allowlist", () => {
    const denial = checkDestination(THIRD, OWN, [OTHER.toLowerCase()]);

    expect(denial).toContain("is not in ZERODUST_ALLOWED_DESTINATIONS");
    // The message should show what *is* allowed, so the agent can explain it.
    expect(denial).toContain(OTHER.toLowerCase());
  });

  it("does not let a near-miss address through", () => {
    // Guards against any substring or prefix comparison creeping in.
    const nearMiss = `${OTHER.slice(0, -1)}0`;
    expect(checkDestination(nearMiss, OWN, [OTHER.toLowerCase()])).not.toBeNull();
  });
});

describe("parseRpcUrls", () => {
  it("is empty when unset", () => {
    expect(parseRpcUrls(undefined)).toEqual({});
    expect(parseRpcUrls("")).toEqual({});
  });

  it("parses chainId=url pairs, tolerating spaces", () => {
    expect(parseRpcUrls(" 8453=https://base.example/rpc , 42161=https://arb.example ")).toEqual({
      8453: "https://base.example/rpc",
      42161: "https://arb.example",
    });
  });

  it("keeps an = inside the URL", () => {
    expect(parseRpcUrls("1=https://eth.example/?key=abc")).toEqual({ 1: "https://eth.example/?key=abc" });
  });

  it.each([
    ["https://no-chain.example", /chainId=url/],
    ["base=https://base.example", /chainId=url/],
    ["0=https://zero.example", /chainId=url/],
    ["8453=not a url", /invalid URL/],
    ["8453=ftp://base.example", /must be http/],
    ["8453=https://a.example,8453=https://b.example", /twice/],
  ])("rejects %s", (value, message) => {
    expect(() => parseRpcUrls(value)).toThrow(message);
  });

  it("is applied by readExecuteConfig", () => {
    const config = readExecuteConfig({
      ZERODUST_PRIVATE_KEY: TEST_KEY,
      ZERODUST_ALLOW_EXECUTE: "true",
      ZERODUST_RPC_URLS: "10=https://op.example",
    });
    expect(config?.rpcUrls).toEqual({ 10: "https://op.example" });
  });
});
