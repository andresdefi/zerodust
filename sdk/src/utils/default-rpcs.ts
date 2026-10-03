/**
 * @fileoverview A public RPC per chain the API serves, so an agent works on
 * every ZeroDust chain without configuration. Pass `rpcUrls` to use your own
 * (a keyed provider is faster and more reliable).
 *
 * Each endpoint answered with the right chain ID and served the read calls a
 * sweep needs (balance, nonce, code, gas price) on 2026-10-01; the same list
 * the zerodust.xyz site uses. tests/default-rpcs.test.ts fails when a chain
 * the API lists has no entry here.
 */

export const DEFAULT_RPC_URLS: Readonly<Record<number, string>> = {
  1: 'https://mainnet.gateway.tenderly.co',
  10: 'https://optimism-rpc.publicnode.com',
  56: 'https://bsc-dataseed4.bnbchain.org',
  100: 'https://gnosis-rpc.publicnode.com',
  130: 'https://unichain-rpc.publicnode.com',
  137: 'https://polygon.gateway.tenderly.co',
  146: 'https://rpc.soniclabs.com',
  169: 'https://pacific-rpc.manta.network/http',
  196: 'https://xlayerrpc.okx.com',
  252: 'https://rpc.frax.com',
  360: 'https://shape-mainnet.g.alchemy.com/public',
  480: 'https://worldchain-mainnet.g.alchemy.com/public',
  988: 'https://rpc.stable.xyz',
  1135: 'https://rpc.api.lisk.com',
  1329: 'https://evm-rpc.sei-apis.com',
  1514: 'https://mainnet.datarpc.io',
  1672: 'https://rpc.pharos.xyz',
  1868: 'https://rpc.soneium.org',
  2020: 'https://ronin.gateway.tenderly.co',
  2818: 'https://rpc-quicknode.morphl2.io',
  4326: 'https://mainnet.megaeth.com/rpc',
  4663: 'https://robinhood-rpc.publicnode.com',
  5000: 'https://mantle-rpc.publicnode.com',
  5031: 'https://api.infra.mainnet.somnia.network',
  5042: 'https://rpc.blockdaemon.mainnet.arc.io',
  5330: 'https://mainnet.superseed.xyz',
  8453: 'https://base-rpc.publicnode.com',
  9745: 'https://rpc.plasma.to',
  33139: 'https://rpc.apechain.com',
  34443: 'https://mainnet.mode.network',
  42018: 'https://mythos-mainnet.g.alchemy.com/public',
  42161: 'https://arbitrum-one-rpc.publicnode.com',
  42220: 'https://forno.celo.org',
  43111: 'https://rpc.hemi.network/rpc',
  48900: 'https://mainnet.zircuit.com',
  57073: 'https://rpc-qnd.inkonchain.com',
  59144: 'https://linea-rpc.publicnode.com',
  60808: 'https://rpc.gobob.xyz',
  80094: 'https://rpc.berachain.com',
  98866: 'https://rpc.plume.org',
  167000: 'https://taiko-rpc.publicnode.com',
  534352: 'https://scroll-rpc.publicnode.com',
  685689: 'https://gensyn-mainnet.g.alchemy.com/public',
  747474: 'https://rpc.katana.network',
  7777777: 'https://rpc.zora.energy/',
  97477: 'https://rpc.doma.xyz',
  124816: 'https://rpc.mitosis.org',
};
