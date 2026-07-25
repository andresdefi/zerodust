/**
 * @fileoverview Tests for signer resolution
 *
 * These cover the four ways a signing key can be supplied, and — more
 * importantly — the ways a setup can be wrong. A misconfigured signer that
 * fails silently or late is worse than one that refuses at startup, because the
 * agent discovers it mid-sweep.
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { hasSignerEnv, resolveSignerSource } from "../src/signer.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");

// The address for the throwaway key used in every fixture.
const EXPECTED_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("hasSignerEnv", () => {
  it("is false for an empty environment", () => {
    expect(hasSignerEnv({})).toBe(false);
  });

  it("is false when a signer variable is set but blank", () => {
    expect(hasSignerEnv({ ZERODUST_PRIVATE_KEY: "   " })).toBe(false);
  });

  it("is true for each of the four signer variables", () => {
    expect(hasSignerEnv({ ZERODUST_PRIVATE_KEY: TEST_KEY })).toBe(true);
    expect(hasSignerEnv({ ZERODUST_PRIVATE_KEY_FILE: "./k" })).toBe(true);
    expect(hasSignerEnv({ ZERODUST_KEYSTORE_FILE: "./k.json" })).toBe(true);
    expect(hasSignerEnv({ ZERODUST_SIGNER_MODULE: "./m.mjs" })).toBe(true);
  });
});

describe("resolveSignerSource", () => {
  it("returns null when nothing is configured", () => {
    expect(resolveSignerSource({})).toBeNull();
  });

  it("refuses an ambiguous setup rather than silently picking one", () => {
    expect(() =>
      resolveSignerSource({
        ZERODUST_PRIVATE_KEY: TEST_KEY,
        ZERODUST_KEYSTORE_FILE: join(FIXTURES, "keystore-scrypt.json"),
      })
    ).toThrow(/Multiple signing keys configured/);
  });

  describe("inline key", () => {
    it("loads the account", async () => {
      const source = resolveSignerSource({ ZERODUST_PRIVATE_KEY: TEST_KEY })!;
      expect(source.kind).toBe("key-env");

      const account = await source.load();
      expect(account.address).toBe(EXPECTED_ADDRESS);
    });

    it("accepts a key without the 0x prefix", async () => {
      const source = resolveSignerSource({ ZERODUST_PRIVATE_KEY: TEST_KEY.slice(2) })!;
      const account = await source.load();
      expect(account.address).toBe(EXPECTED_ADDRESS);
    });

    it("rejects a key that is not 32 bytes", async () => {
      const source = resolveSignerSource({ ZERODUST_PRIVATE_KEY: "0xdeadbeef" })!;
      await expect(source.load()).rejects.toThrow(/32-byte hex private key/);
    });

    it("never puts key material in the description", () => {
      const source = resolveSignerSource({ ZERODUST_PRIVATE_KEY: TEST_KEY })!;
      expect(source.description).not.toContain(TEST_KEY.slice(2, 20));
    });
  });

  describe("key file", () => {
    it("loads the account and tolerates a trailing newline", async () => {
      const source = resolveSignerSource({
        ZERODUST_PRIVATE_KEY_FILE: join(FIXTURES, "agent.key"),
      })!;
      expect(source.kind).toBe("key-file");

      const account = await source.load();
      expect(account.address).toBe(EXPECTED_ADDRESS);
    });

    it("reports the path, not the key, when the file is missing", async () => {
      const source = resolveSignerSource({
        ZERODUST_PRIVATE_KEY_FILE: join(FIXTURES, "does-not-exist.key"),
      })!;
      await expect(source.load()).rejects.toThrow(/ZERODUST_PRIVATE_KEY_FILE could not be read/);
    });
  });

  describe("keystore", () => {
    it("decrypts a scrypt keystore", async () => {
      const source = resolveSignerSource({
        ZERODUST_KEYSTORE_FILE: join(FIXTURES, "keystore-scrypt.json"),
        ZERODUST_KEYSTORE_PASSWORD: "test-password",
      })!;
      expect(source.kind).toBe("keystore");

      const account = await source.load();
      expect(account.address).toBe(EXPECTED_ADDRESS);
    });

    it("decrypts a pbkdf2 keystore", async () => {
      const source = resolveSignerSource({
        ZERODUST_KEYSTORE_FILE: join(FIXTURES, "keystore-pbkdf2.json"),
        ZERODUST_KEYSTORE_PASSWORD: "test-password",
      })!;

      const account = await source.load();
      expect(account.address).toBe(EXPECTED_ADDRESS);
    });

    it("reads the password from a file, stripping the trailing newline", async () => {
      const source = resolveSignerSource({
        ZERODUST_KEYSTORE_FILE: join(FIXTURES, "keystore-scrypt.json"),
        ZERODUST_KEYSTORE_PASSWORD_FILE: join(FIXTURES, "password.txt"),
      })!;

      const account = await source.load();
      expect(account.address).toBe(EXPECTED_ADDRESS);
    });

    it("rejects a wrong password via the MAC check", async () => {
      const source = resolveSignerSource({
        ZERODUST_KEYSTORE_FILE: join(FIXTURES, "keystore-scrypt.json"),
        ZERODUST_KEYSTORE_PASSWORD: "wrong-password",
      })!;

      await expect(source.load()).rejects.toThrow(/password is incorrect/);
    });

    it("requires a password up front rather than failing at sweep time", () => {
      expect(() =>
        resolveSignerSource({
          ZERODUST_KEYSTORE_FILE: join(FIXTURES, "keystore-scrypt.json"),
        })
      ).toThrow(/no password was provided/);
    });

    it("refuses two password sources", () => {
      expect(() =>
        resolveSignerSource({
          ZERODUST_KEYSTORE_FILE: join(FIXTURES, "keystore-scrypt.json"),
          ZERODUST_KEYSTORE_PASSWORD: "test-password",
          ZERODUST_KEYSTORE_PASSWORD_FILE: join(FIXTURES, "password.txt"),
        })
      ).toThrow(/Choose one/);
    });
  });

  describe("signer module", () => {
    it("loads an account from a module's default export", async () => {
      const source = resolveSignerSource({
        ZERODUST_SIGNER_MODULE: join(FIXTURES, "signer-module.mjs"),
      })!;
      expect(source.kind).toBe("module");

      const account = await source.load();
      expect(account.address).toBe(EXPECTED_ADDRESS);
    });

    it("reports a module that cannot be loaded", async () => {
      const source = resolveSignerSource({
        ZERODUST_SIGNER_MODULE: join(FIXTURES, "no-such-module.mjs"),
      })!;

      await expect(source.load()).rejects.toThrow(/could not be loaded/);
    });

    it("rejects a module returning something that cannot sign an authorization", async () => {
      // A plain viem account without signAuthorization would fail deep inside a
      // sweep; it has to be caught when the signer is resolved instead.
      const source = resolveSignerSource({
        ZERODUST_SIGNER_MODULE: join(FIXTURES, "signer-module-bad.mjs"),
      })!;

      await expect(source.load()).rejects.toThrow(/signAuthorization/);
    });
  });
});
