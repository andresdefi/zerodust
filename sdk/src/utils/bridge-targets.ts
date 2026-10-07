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

export type BridgeName = 'gaszip' | 'relay' | 'across' | 'hyperlane' | 'endurance' | 'stargate';

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
  648, // Endurance: only Fusionist's bridge takes ACE out
  // Gas.zip delivers into these but takes nothing out (checked 2026-10-07)
  8217, // Kaia
  16661, // 0G
  42170, // Arbitrum Nova: listed with outbound off
  1155, // Intuition: only Caldera's Metalayer takes TRUST out
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
 * TRUST: Caldera's Metalayer (its own Hyperlane deployment, the same
 * transferRemote): Intuition's MetaNativeSpoke -> canonical TRUST on Base.
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
  1155: {
    router: '0x375135fe908dD62f3C7939FA4e65bf41Da721AB9',
    toChainId: 8453,
    destinationDomain: 8453,
    token: { symbol: 'TRUST', address: '0x6cd905dF2Ed214b22e0d48FF17CD4200C1C6d8A3', decimals: 18 },
  },
};

/**
 * Fusionist's Endurance bridge (token delivery): ACE leaves as the ACE token on
 * BNB Chain, and only to the sending wallet (the bridge call has no recipient).
 * Pinned; mirrors the backend's bridges/endurance.ts.
 */
export const ENDURANCE_ROUTE = {
  chainId: 648,
  bridge: '0xf3310e3f0D46FF5EE7daB69C73452D0ff3979Bed' as Address,
  toChainId: 56,
  token: { symbol: 'ACE', address: '0xc27A719105A987b4c34116223CAE8bd8F4B5def4' as Address, decimals: 18 } satisfies DeliveredToken,
} as const;

/**
 * Stargate V2 native-ETH pools (StargatePoolNative): ETH in, native ETH out, called directly.
 * Pinned with their LayerZero endpoint ids (read on-chain 2026-10-07); mirrors the backend's
 * bridges/stargate.ts. Lightlink is a destination only.
 */
export const STARGATE_NATIVE_POOLS: Readonly<Record<number, { pool: Address; eid: number }>> = {
  1: { pool: '0x77b2043768d28E9C9aB44E1aBfC95944bcE57931', eid: 30101 },
  10: { pool: '0xe8CDF27AcD73a434D661C84887215F7598e7d0d3', eid: 30111 },
  130: { pool: '0xe9aBA835f813ca05E50A6C0ce65D0D74390F7dE7', eid: 30320 },
  169: { pool: '0x9895D81bB462A195b4922ED7De0e3ACD007c32CB', eid: 30217 },
  1868: { pool: '0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590', eid: 30340 },
  1890: { pool: '0x8731d54E9D02c286767d56ac03e8037C07e01e98', eid: 30309 },
  8453: { pool: '0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7', eid: 30184 },
  42161: { pool: '0xA45B5130f36CDcA45667738e2a258AB09f4A5f7F', eid: 30110 },
  43111: { pool: '0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590', eid: 30329 },
  59144: { pool: '0x81F6138153d473E8c5EcebD3DC8Cd4903506B075', eid: 30183 },
  97477: { pool: '0x5d46805BBFAcA875a96Ebbd22Aaa3DE4A81180f5', eid: 30393 },
  534352: { pool: '0xC2b638Cb5042c1B3c5d5C969361fB50569840583', eid: 30214 },
};

/** Where a Stargate send's LayerZero fee refund must go: ZeroDust, never the sweeping wallet */
export const STARGATE_REFUND_ADDRESS: Address = '0x01eD5c94DE39E73C986b98B85C2c0A3d1BEDff7D';

/** The token a sweep from `fromChainId` to `toChainId` delivers instead of gas, or null for a gas route */
export function deliveredToken(fromChainId: number, toChainId: number): DeliveredToken | null {
  const route = HYPERLANE_ROUTES[fromChainId];
  if (route && route.toChainId === toChainId) return route.token;
  if (fromChainId === ENDURANCE_ROUTE.chainId && toChainId === ENDURANCE_ROUTE.toChainId) return ENDURANCE_ROUTE.token;
  return null;
}

/** Routes whose bridge can only pay the sweeping wallet itself (no recipient in the call) */
export function deliversOnlyToSender(fromChainId: number, toChainId: number): boolean {
  return fromChainId === ENDURANCE_ROUTE.chainId && toChainId === ENDURANCE_ROUTE.toChainId;
}

// ============ Lookup ============

/** Every chain the ZeroDust contract is deployed on (mainnet; Kaia, 0G, Arbitrum Nova and Intuition 2026-10-07) */
export const ZERODUST_MAINNET_CHAIN_IDS: readonly number[] = [
  1, 10, 56, 100, 130, 137, 146, 169, 196, 252, 360, 480, 648, 988, 1135, 1155, 1329, 1514, 1672, 1868,
  2020, 2818, 4326, 4663, 5000, 5031, 5042, 5330, 8217, 8453, 9745, 16661, 33139, 34443, 42018, 42161,
  42170, 42220, 43111, 48900, 57073, 59144, 60808, 80094, 97477, 98866, 124816, 167000, 534352,
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
  add(ENDURANCE_ROUTE.chainId, ENDURANCE_ROUTE.bridge, 'endurance');
  for (const [chainId, p] of Object.entries(STARGATE_NATIVE_POOLS)) add(Number(chainId), p.pool, 'stargate');
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
