/**
 * @fileoverview Tests for signer resolution
 *
 * These cover the four ways a signing key can be supplied, and — more
 * importantly — the ways a setup can be wrong. A misconfigured signer that
 * fails silently or late is worse than one that refuses at startup, because the
 * agent discovers it mid-sweep.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { hasSignerEnv, resolveSignerSource } from "../src/signer.js";
import {
  createSignerFixtures,
  KEYSTORE_PASSWORD,
  TEST_ADDRESS,
  TEST_KEY,
  type SignerFixtures,
} from "./helpers/signer-fixtures.js";

// Fixtures are generated at run time rather than committed. `.gitignore` has
// `*.key`, so a checked-in key file was silently untracked and these tests
// passed only on the machine that created it.
let fixtures: SignerFixtures;

beforeAll(() => {
  fixtures = createSignerFixtures();
});

const EXPECTED_ADDRESS = TEST_ADDRESS;

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
        ZERODUST_KEYSTORE_FILE: fixtures.keystoreScrypt,
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
        ZERODUST_PRIVATE_KEY_FILE: fixtures.keyFile,
      })!;
      expect(source.kind).toBe("key-file");

      const account = await source.load();
      expect(account.address).toBe(EXPECTED_ADDRESS);
    });

    it("reports the path, not the key, when the file is missing", async () => {
      const source = resolveSignerSource({
        ZERODUST_PRIVATE_KEY_FILE: join(fixtures.dir, "does-not-exist.key"),
      })!;
      await expect(source.load()).rejects.toThrow(/ZERODUST_PRIVATE_KEY_FILE could not be read/);
    });
  });

  describe("keystore", () => {
    it("decrypts a scrypt keystore", async () => {
      const source = resolveSignerSource({
        ZERODUST_KEYSTORE_FILE: fixtures.keystoreScrypt,
        ZERODUST_KEYSTORE_PASSWORD: KEYSTORE_PASSWORD,
      })!;
      expect(source.kind).toBe("keystore");

      const account = await source.load();
      expect(account.address).toBe(EXPECTED_ADDRESS);
    });

    it("decrypts a pbkdf2 keystore", async () => {
      const source = resolveSignerSource({
        ZERODUST_KEYSTORE_FILE: fixtures.keystorePbkdf2,
        ZERODUST_KEYSTORE_PASSWORD: KEYSTORE_PASSWORD,
      })!;

      const account = await source.load();
      expect(account.address).toBe(EXPECTED_ADDRESS);
    });

    it("reads the password from a file, stripping the trailing newline", async () => {
      const source = resolveSignerSource({
        ZERODUST_KEYSTORE_FILE: fixtures.keystoreScrypt,
        ZERODUST_KEYSTORE_PASSWORD_FILE: fixtures.passwordFile,
      })!;

      const account = await source.load();
      expect(account.address).toBe(EXPECTED_ADDRESS);
    });

    it("rejects a wrong password via the MAC check", async () => {
      const source = resolveSignerSource({
        ZERODUST_KEYSTORE_FILE: fixtures.keystoreScrypt,
        ZERODUST_KEYSTORE_PASSWORD: "wrong-password",
      })!;

      await expect(source.load()).rejects.toThrow(/password is incorrect/);
    });

    it("requires a password up front rather than failing at sweep time", () => {
      expect(() =>
        resolveSignerSource({
          ZERODUST_KEYSTORE_FILE: fixtures.keystoreScrypt,
        })
      ).toThrow(/no password was provided/);
    });

    it("refuses two password sources", () => {
      expect(() =>
        resolveSignerSource({
          ZERODUST_KEYSTORE_FILE: fixtures.keystoreScrypt,
          ZERODUST_KEYSTORE_PASSWORD: KEYSTORE_PASSWORD,
          ZERODUST_KEYSTORE_PASSWORD_FILE: fixtures.passwordFile,
        })
      ).toThrow(/Choose one/);
    });
  });

  describe("signer module", () => {
    it("loads an account from a module's default export", async () => {
      const source = resolveSignerSource({
        ZERODUST_SIGNER_MODULE: fixtures.signerModule,
      })!;
      expect(source.kind).toBe("module");

      const account = await source.load();
      expect(account.address).toBe(EXPECTED_ADDRESS);
    });

    it("reports a module that cannot be loaded", async () => {
      const source = resolveSignerSource({
        ZERODUST_SIGNER_MODULE: join(fixtures.dir, "no-such-module.mjs"),
      })!;

      await expect(source.load()).rejects.toThrow(/could not be loaded/);
    });

    it("rejects a module returning something that cannot sign an authorization", async () => {
      // A plain viem account without signAuthorization would fail deep inside a
      // sweep; it has to be caught when the signer is resolved instead.
      const source = resolveSignerSource({
        ZERODUST_SIGNER_MODULE: fixtures.signerModuleBad,
      })!;

      await expect(source.load()).rejects.toThrow(/signAuthorization/);
    });
  });
});
