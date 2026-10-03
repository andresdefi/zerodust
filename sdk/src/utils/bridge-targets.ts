/**
 * @fileoverview Bridge contracts a cross-chain sweep may call, per source chain
 *
 * A cross-chain sweep signs `callTarget` and `routeHash = keccak256(callData)`,
 * and the ZeroDust contract then calls `callTarget` with the user's whole
 * balance. The SDK must therefore never sign a call target it does not know,
 * whatever the API says. This module is that list.
 *
 * Sources (2026-09-30):
 * - Gas.zip: the v1 contract forwarders the ZeroDust backend builds calldata
 *   for (`deposit(uint256 chainShort, address recipient)`), per its adapter's
 *   per-chain map. Gas.zip docs: https://dev.gas.zip/gas/chain-support/inbound
 * - Relay: `GET https://api.relay.link/chains`, each chain's
 *   `protocol.v2.depository` (native deposits, `depositNative(address,bytes32)`)
 *   and `contracts.erc20Router` (`multicall(...)`, used where the origin gas
 *   token is swapped first), confirmed against live `POST /quote` responses.
 * - Across: `SpokePoolPeriphery` (`depositNative(...)`, `swapAndBridge(...)`),
 *   the `swapTx.to` of live `GET /api/swap/approval` quotes from every ZeroDust
 *   chain Across serves, with code verified on each chain.
 *
 * A chain or bridge missing here fails closed: the sweep is refused before
 * anything is signed. Adding a bridge contract needs an SDK release.
 */

import { type Address, type Hex, getAddress } from 'viem';

export type BridgeName = 'gaszip' | 'relay' | 'across' | 'hyperlane';

// ============ Gas.zip ============

/** Gas.zip v1 contract forwarder, default on most chains */
export const GASZIP_FORWARDER_DEFAULT: Address = '0x2a37D63EAdFe4b4682a3c28C1c2cD4F109Cc2762';

/** Chains whose Gas.zip forwarder is not the default (mirrors the backend adapter) */
const GASZIP_FORWARDER_OVERRIDES: Readonly<Record<number, Address>> = {
  1329: '0x3ac2cD998cB96a699f88C3C665abC767A9800cc8', // Sei
  2020: '0x31030df252cb281d8b94863af6af4af8774adb7e', // Ronin
  42220: '0xA60768b03eB14d940F6c9a8553329B7F9037C91b', // Celo
  59144: '0xA60768b03eB14d940F6c9a8553329B7F9037C91b', // Linea
  98866: '0xc62155f48D2aEE12FFF6Bb3b7946385d3A98854C', // Plume
  747474: '0x9E22ebeC84c7e4C4bD6D4aE7FF6f4D436D6D8390', // Katana
  9745: '0x9E22ebeC84c7e4C4bD6D4aE7FF6f4D436D6D8390', // Plasma
  988: '0x9E22ebeC84c7e4C4bD6D4aE7FF6f4D436D6D8390', // Stable
  1672: '0x9E22ebeC84c7e4C4bD6D4aE7FF6f4D436D6D8390', // Pharos
  5042: '0x9E22ebeC84c7e4C4bD6D4aE7FF6f4D436D6D8390', // Arc
};

/**
 * Source chains Gas.zip does not credit even though it lists them (MegaETH),
 * so no Gas.zip target is allowed there.
 */
const GASZIP_SOURCE_DENYLIST: ReadonlySet<number> = new Set([
  4326, // MegaETH: listed, never credited
  97477, // Doma: Gas.zip does not serve it
  124816, // Mitosis: Gas.zip does not take it as a source
]);

// ============ Relay ============

const RELAY_DEPOSITORY: Address = '0x4cd00e387622c35bddb9b4c962c136462338bc31';
const RELAY_ERC20_ROUTER: Address = '0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f';
// Mantle and Linea run their own deployments
const RELAY_DEPOSITORY_ALT: Address = '0x59916da825d2d2ec1bf878d71c88826f6633ecca';
const RELAY_ERC20_ROUTER_ALT: Address = '0x9ef6d3c2f60d7b9008d74cab1fc0f899c957c819';

/** ZeroDust chains Relay serves as an origin with the standard deployment */
const RELAY_STANDARD_CHAINS = [
  1, 10, 56, 100, 130, 137, 146, 169, 196, 360, 480, 988, 1135, 1868, 2020, 2818, 4326, 4663,
  5031, 5042, 5330, 8453, 9745, 33139, 34443, 42018, 42161, 42220, 48900, 57073, 60808,
  80094, 97477, 98866, 534352, 685689, 747474, 7777777,
] as const;
const RELAY_ALT_CHAINS = [5000, 59144] as const;

// ============ Across ============

const ACROSS_SPOKE_POOL_PERIPHERY: Address = '0x97ccdbea4632140639ad5ea9b944aa034eb15fd4';

/** ZeroDust chains Across's swap API serves, periphery code verified on each */
const ACROSS_CHAINS = [
  1, 10, 56, 130, 137, 480, 1868, 4326, 4663, 8453, 9745, 42161, 57073, 59144,
] as const;

// ============ Hyperlane (token delivery) ============

/** A token the destination receives instead of native gas */
export interface DeliveredToken {
  symbol: string;
  address: Address;
  decimals: number;
}

/**
 * Hyperlane warp routes ZeroDust sweeps through (token delivery): the source
 * chain's native coin is locked and minted as an ERC-20 on the destination, so
 * the user receives that token, not gas. Pinned; mirrors the backend's
 * bridges/hyperlane.ts. MITO: Hyperlane registry deployments/warp_routes/MITO.
 */
export const HYPERLANE_ROUTES: Readonly<Record<number, {
  router: Address;
  toChainId: number;
  destinationDomain: number;
  token: DeliveredToken;
}>> = {
  124816: {
    router: '0xF6CC9B10c607afB777380bF71F272E4D7037C3A9',
    toChainId: 56,
    destinationDomain: 56,
    token: { symbol: 'MITO', address: '0x8e1e6BF7E13C400269987B65Ab2b5724b016CaEF', decimals: 18 },
  },
};

/** The token a sweep from `fromChainId` to `toChainId` delivers instead of gas, or null for a gas route */
export function deliveredToken(fromChainId: number, toChainId: number): DeliveredToken | null {
  const route = HYPERLANE_ROUTES[fromChainId];
  return route && route.toChainId === toChainId ? route.token : null;
}

// ============ Lookup ============

/** Every chain the ZeroDust contract is deployed on (mainnet; Mitosis 2026-10-03) */
export const ZERODUST_MAINNET_CHAIN_IDS: readonly number[] = [
  1, 10, 56, 100, 130, 137, 146, 169, 196, 252, 360, 480, 988, 1135, 1329, 1514, 1672, 1868,
  2020, 2818, 4326, 4663, 5000, 5031, 5042, 5330, 8453, 9745, 33139, 34443, 42018, 42161,
  42220, 43111, 48900, 57073, 59144, 60808, 80094, 97477, 98866, 124816, 167000, 534352,
  685689, 747474, 7777777,
];

function buildTargets(): Map<number, Map<string, BridgeName>> {
  const table = new Map<number, Map<string, BridgeName>>();
  const add = (chainId: number, address: Address, bridge: BridgeName) => {
    let entry = table.get(chainId);
    if (!entry) {
      entry = new Map();
      table.set(chainId, entry);
    }
    entry.set(address.toLowerCase(), bridge);
  };

  for (const chainId of ZERODUST_MAINNET_CHAIN_IDS) {
    if (GASZIP_SOURCE_DENYLIST.has(chainId)) continue;
    add(chainId, GASZIP_FORWARDER_OVERRIDES[chainId] ?? GASZIP_FORWARDER_DEFAULT, 'gaszip');
  }
  for (const chainId of RELAY_STANDARD_CHAINS) {
    add(chainId, RELAY_DEPOSITORY, 'relay');
    add(chainId, RELAY_ERC20_ROUTER, 'relay');
  }
  for (const chainId of RELAY_ALT_CHAINS) {
    add(chainId, RELAY_DEPOSITORY_ALT, 'relay');
    add(chainId, RELAY_ERC20_ROUTER_ALT, 'relay');
  }
  for (const chainId of ACROSS_CHAINS) {
    add(chainId, ACROSS_SPOKE_POOL_PERIPHERY, 'across');
  }
  for (const [chainId, route] of Object.entries(HYPERLANE_ROUTES)) {
    add(Number(chainId), route.router, 'hyperlane');
  }
  return table;
}

const BRIDGE_TARGETS = buildTargets();

/**
 * Which bridge a call target on a source chain belongs to, or null when it is
 * not a known bridge contract there.
 */
export function bridgeForCallTarget(chainId: number, callTarget: string): BridgeName | null {
  return BRIDGE_TARGETS.get(chainId)?.get(callTarget.toLowerCase()) ?? null;
}

/** The known bridge contracts on a source chain (checksummed) */
export function allowedCallTargets(chainId: number): Array<{ address: Address; bridge: BridgeName }> {
  const entry = BRIDGE_TARGETS.get(chainId);
  if (!entry) return [];
  return [...entry.entries()].map(([address, bridge]) => ({ address: getAddress(address), bridge }));
}

// ============ Gas.zip calldata ============

/**
 * The v1 forwarder calldata the backend builds: `deposit(uint256 chainShort,
 * address recipient)`, selector 0x6e553f65.
 */
export function buildGasZipDepositCalldata(chainShort: number, recipient: Address): Hex {
  const short = BigInt(chainShort).toString(16).padStart(64, '0');
  const to = recipient.slice(2).toLowerCase().padStart(64, '0');
  return `0x6e553f65${short}${to}` as Hex;
}

const GASZIP_CHAINS_URL = 'https://backend.gas.zip/v2/chains';
const GASZIP_CHAINS_TTL_MS = 10 * 60 * 1000;

/**
 * Resolves a chain ID to Gas.zip's internal short ID, straight from Gas.zip
 * (not from the ZeroDust API, which is what is being checked). Cached.
 */
export function createGasZipChainShortResolver(
  fetchImpl: typeof fetch = (...args) => fetch(...args)
): (chainId: number) => Promise<number | undefined> {
  let cache: { at: number; map: Promise<Map<number, number>> } | null = null;

  const load = async (): Promise<Map<number, number>> => {
    const response = await fetchImpl(GASZIP_CHAINS_URL);
    if (!response.ok) throw new Error(`Gas.zip chain list unavailable (${response.status})`);
    const body = (await response.json()) as { chains?: Array<{ chain: number; short: number }> };
    const map = new Map<number, number>();
    for (const c of body.chains ?? []) {
      if (Number.isInteger(c.chain) && Number.isInteger(c.short)) map.set(c.chain, c.short);
    }
    return map;
  };

  return async (chainId: number) => {
    if (!cache || Date.now() - cache.at > GASZIP_CHAINS_TTL_MS) {
      const map = load();
      cache = { at: Date.now(), map };
      // A failed load must not be cached
      map.catch(() => {
        cache = null;
      });
    }
    return (await cache.map).get(chainId);
  };
}
