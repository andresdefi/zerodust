/**
 * @fileoverview Signer resolution for the ZeroDust MCP server
 *
 * Sweeping requires a key that can produce an EIP-712 signature and two
 * EIP-7702 authorizations. The original server accepted exactly one form of
 * that key: a raw hex private key in an environment variable, which in practice
 * means pasting a hot key into an MCP client's JSON config. Operators running
 * agents with real balances decline to do that, which is precisely the
 * population with the most stranded gas.
 *
 * So there are four ways in, in descending order of precedence:
 *
 *   ZERODUST_SIGNER_MODULE     a module that returns a viem LocalAccount
 *   ZERODUST_KEYSTORE_FILE     an encrypted V3 keystore + password
 *   ZERODUST_PRIVATE_KEY_FILE  a file containing a hex key
 *   ZERODUST_PRIVATE_KEY       a hex key inline (unchanged, still supported)
 *
 * The module hook is the important one. Rather than depending on Turnkey,
 * Privy, AWS KMS and every future custody vendor, this server loads any module
 * that hands back a viem `LocalAccount` — which every one of those vendors
 * already knows how to produce. ZeroDust stays out of the custody business and
 * the integration surface stops growing.
 */

import { readFile } from "node:fs/promises";
import {
  createDecipheriv,
  pbkdf2 as pbkdf2Cb,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { pathToFileURL } from "node:url";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { keccak256, type Hex, type LocalAccount } from "viem";

// Hand-rolled rather than promisify()'d: both functions are overloaded, and
// promisify resolves to the shortest overload, which drops the options argument
// scrypt needs for its memory limit.
function scrypt(
  secret: Buffer,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(secret, salt, keylen, options, (error, key) =>
      error ? reject(error) : resolve(key)
    );
  });
}

function pbkdf2(
  secret: Buffer,
  salt: Buffer,
  iterations: number,
  keylen: number,
  digest: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2Cb(secret, salt, iterations, keylen, digest, (error, key) =>
      error ? reject(error) : resolve(key)
    );
  });
}

const PRIVATE_KEY_RE = /^0x[a-fA-F0-9]{64}$/;

/** How the signing key was supplied, for diagnostics and the address tool. */
export type SignerKind = "module" | "keystore" | "key-file" | "key-env";

export interface SignerSource {
  kind: SignerKind;
  /** Human-readable origin, safe to show an agent. Never contains key material. */
  description: string;
  /** Resolves the account. Called at most once per process. */
  load: () => Promise<LocalAccount>;
}

/** Env var names that supply a key, in precedence order. */
const SIGNER_ENV_VARS = [
  "ZERODUST_SIGNER_MODULE",
  "ZERODUST_KEYSTORE_FILE",
  "ZERODUST_PRIVATE_KEY_FILE",
  "ZERODUST_PRIVATE_KEY",
] as const;

/** True when any signer variable is present, used to detect a partial setup. */
export function hasSignerEnv(env: NodeJS.ProcessEnv): boolean {
  return SIGNER_ENV_VARS.some((name) => Boolean(env[name]?.trim()));
}

/**
 * Picks the signer source from the environment.
 *
 * @returns the source, or null when no signer variable is set
 * @throws when more than one is set, or when the chosen one is incomplete
 */
export function resolveSignerSource(env: NodeJS.ProcessEnv = process.env): SignerSource | null {
  const present = SIGNER_ENV_VARS.filter((name) => Boolean(env[name]?.trim()));

  if (present.length === 0) return null;
  if (present.length > 1) {
    throw new Error(
      `Multiple signing keys configured (${present.join(", ")}). ` +
        "Set exactly one so it is unambiguous which key signs."
    );
  }

  const [chosen] = present;

  switch (chosen) {
    case "ZERODUST_SIGNER_MODULE":
      return moduleSource(env.ZERODUST_SIGNER_MODULE!.trim());
    case "ZERODUST_KEYSTORE_FILE":
      return keystoreSource(env);
    case "ZERODUST_PRIVATE_KEY_FILE":
      return keyFileSource(env.ZERODUST_PRIVATE_KEY_FILE!.trim());
    default:
      return keyEnvSource(env.ZERODUST_PRIVATE_KEY!.trim());
  }
}

// ============ Sources ============

/**
 * Loads a caller-supplied module and uses whatever account it returns.
 *
 * Accepted shapes, in order: a default export that is a function, a named
 * `createAccount` function, or a default export that is already an account.
 * Functions may be async, which is what lets a remote signer do a round trip
 * (fetch a Turnkey/Privy session, resolve a KMS key) before returning.
 */
function moduleSource(specifier: string): SignerSource {
  return {
    kind: "module",
    description: `signer module ${specifier}`,
    load: async () => {
      // Relative paths resolve against cwd, not against this file, because the
      // operator writes them relative to where they launch the server.
      const target =
        specifier.startsWith(".") || isAbsolute(specifier)
          ? pathToFileURL(resolvePath(process.cwd(), specifier)).href
          : specifier;

      let mod: Record<string, unknown>;
      try {
        mod = (await import(target)) as Record<string, unknown>;
      } catch (error) {
        throw new Error(
          `ZERODUST_SIGNER_MODULE could not be loaded (${specifier}): ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
      }

      const factory = mod.default ?? mod.createAccount;
      const candidate = typeof factory === "function" ? await factory() : factory;

      return assertLocalAccount(candidate, specifier);
    },
  };
}

/**
 * Decrypts a Web3 Secret Storage (V3) keystore — the format produced by
 * `cast wallet import`, geth, and most key management tooling. The password can
 * come from a variable or, better, from a file that never enters the MCP config.
 */
function keystoreSource(env: NodeJS.ProcessEnv): SignerSource {
  const file = env.ZERODUST_KEYSTORE_FILE!.trim();
  const inlinePassword = env.ZERODUST_KEYSTORE_PASSWORD;
  const passwordFile = env.ZERODUST_KEYSTORE_PASSWORD_FILE?.trim();

  if (inlinePassword === undefined && !passwordFile) {
    throw new Error(
      "ZERODUST_KEYSTORE_FILE is set but no password was provided. " +
        "Set ZERODUST_KEYSTORE_PASSWORD_FILE (preferred) or ZERODUST_KEYSTORE_PASSWORD."
    );
  }
  if (inlinePassword !== undefined && passwordFile) {
    throw new Error(
      "Both ZERODUST_KEYSTORE_PASSWORD and ZERODUST_KEYSTORE_PASSWORD_FILE are set. Choose one."
    );
  }

  return {
    kind: "keystore",
    description: `keystore ${file}`,
    load: async () => {
      const password = passwordFile
        ? // Trailing newlines are near-universal in password files and are
          // essentially never part of the password.
          (await readFileText(passwordFile, "ZERODUST_KEYSTORE_PASSWORD_FILE")).replace(/\r?\n$/, "")
        : inlinePassword!;

      const raw = await readFileText(file, "ZERODUST_KEYSTORE_FILE");
      const privateKey = await decryptV3Keystore(raw, password);
      return toAccount(privateKey);
    },
  };
}

/** Reads a hex private key from a file, so it never appears in a config file. */
function keyFileSource(file: string): SignerSource {
  return {
    kind: "key-file",
    description: `key file ${file}`,
    load: async () => {
      const contents = (await readFileText(file, "ZERODUST_PRIVATE_KEY_FILE")).trim();
      return toAccount(normalizeKey(contents, `the contents of ${file}`));
    },
  };
}

function keyEnvSource(value: string): SignerSource {
  return {
    kind: "key-env",
    description: "ZERODUST_PRIVATE_KEY (inline)",
    load: async () => toAccount(normalizeKey(value, "ZERODUST_PRIVATE_KEY")),
  };
}

// ============ Helpers ============

async function readFileText(file: string, label: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    throw new Error(
      `${label} could not be read (${file}): ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function normalizeKey(value: string, label: string): Hex {
  const candidate = (value.startsWith("0x") ? value : `0x${value}`) as Hex;
  if (!PRIVATE_KEY_RE.test(candidate)) {
    throw new Error(`${label} must be a 32-byte hex private key.`);
  }
  return candidate;
}

async function toAccount(privateKey: Hex): Promise<LocalAccount> {
  const { privateKeyToAccount } = await import("viem/accounts");
  return privateKeyToAccount(privateKey);
}

/**
 * Verifies a module returned something that can actually sign a sweep.
 *
 * `signAuthorization` is the load-bearing one: without it the EIP-7702
 * delegation cannot be produced, and a signer missing it would otherwise fail
 * deep inside a sweep instead of at startup.
 */
function assertLocalAccount(candidate: unknown, specifier: string): LocalAccount {
  const account = candidate as Partial<LocalAccount> | undefined;

  if (!account || typeof account !== "object") {
    throw new Error(
      `ZERODUST_SIGNER_MODULE (${specifier}) did not return an account. ` +
        "Export a default function returning a viem LocalAccount."
    );
  }

  const missing = (["address", "signTypedData", "signAuthorization"] as const).filter((key) => {
    const value = account[key];
    return key === "address" ? typeof value !== "string" : typeof value !== "function";
  });

  if (missing.length > 0) {
    throw new Error(
      `ZERODUST_SIGNER_MODULE (${specifier}) returned an object missing ${missing.join(", ")}. ` +
        "ZeroDust needs a viem LocalAccount that can sign EIP-712 typed data and " +
        "EIP-7702 authorizations."
    );
  }

  return account as LocalAccount;
}

// ============ V3 keystore ============

interface KeystoreV3 {
  version: number;
  crypto?: KeystoreCrypto;
  Crypto?: KeystoreCrypto;
}

interface KeystoreCrypto {
  cipher: string;
  ciphertext: string;
  cipherparams: { iv: string };
  kdf: string;
  kdfparams: Record<string, unknown>;
  mac: string;
}

/**
 * Decrypts a V3 keystore to its private key.
 *
 * Implemented directly on node:crypto rather than pulling in a keystore
 * library, because the whole format is one KDF, one AES-CTR decryption, and one
 * keccak MAC check, and this server's dependency surface is worth keeping thin.
 */
async function decryptV3Keystore(raw: string, password: string): Promise<Hex> {
  let parsed: KeystoreV3;
  try {
    parsed = JSON.parse(raw) as KeystoreV3;
  } catch {
    throw new Error("Keystore file is not valid JSON.");
  }

  // Older tooling capitalises the key.
  const crypto = parsed.crypto ?? parsed.Crypto;
  if (!crypto) throw new Error("Keystore file has no \"crypto\" section.");
  if (parsed.version !== 3) {
    throw new Error(`Unsupported keystore version ${parsed.version}. Only V3 is supported.`);
  }
  if (crypto.cipher !== "aes-128-ctr") {
    throw new Error(`Unsupported keystore cipher "${crypto.cipher}". Expected aes-128-ctr.`);
  }

  const derived = await deriveKey(crypto, password);
  const ciphertext = Buffer.from(crypto.ciphertext, "hex");

  // MAC covers the second half of the derived key plus the ciphertext. A
  // mismatch means the password is wrong (or the file was tampered with).
  const mac = keccak256(Buffer.concat([derived.subarray(16, 32), ciphertext]) as never).slice(2);
  const expected = Buffer.from(crypto.mac.replace(/^0x/, ""), "hex");
  const actual = Buffer.from(mac, "hex");

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Keystore MAC mismatch - the password is incorrect.");
  }

  const decipher = createDecipheriv(
    "aes-128-ctr",
    derived.subarray(0, 16),
    Buffer.from(crypto.cipherparams.iv, "hex")
  );
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return normalizeKey(plaintext.toString("hex"), "The decrypted keystore key");
}

async function deriveKey(crypto: KeystoreCrypto, password: string): Promise<Buffer> {
  const params = crypto.kdfparams;
  const salt = Buffer.from(String(params.salt), "hex");
  const dklen = Number(params.dklen ?? 32);
  const secret = Buffer.from(password, "utf8");

  if (crypto.kdf === "scrypt") {
    const N = Number(params.n);
    const r = Number(params.r);
    const p = Number(params.p);

    // Node caps scrypt memory at 32MB by default, which the standard geth
    // parameters (N=262144, r=8) blow straight through. Size it from the
    // parameters instead of failing with an opaque error.
    const maxmem = 256 * N * r;

    return scrypt(secret, salt, dklen, { N, r, p, maxmem });
  }

  if (crypto.kdf === "pbkdf2") {
    const prf = String(params.prf ?? "hmac-sha256");
    if (prf !== "hmac-sha256") {
      throw new Error(`Unsupported keystore PRF "${prf}". Expected hmac-sha256.`);
    }
    return pbkdf2(secret, salt, Number(params.c), dklen, "sha256");
  }

  throw new Error(`Unsupported keystore KDF "${crypto.kdf}". Expected scrypt or pbkdf2.`);
}
