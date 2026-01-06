import {
  mainnet,
  sepolia,
  bsc,
  bscTestnet,
  base,
  baseSepolia,
  arbitrum,
  arbitrumSepolia,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  gnosis,
  gnosisChiado,
} from 'viem/chains';
import type { Chain } from 'viem';

export interface ChainConfig {
  chain: Chain;
  name: string;
  nativeToken: string;
  nativeTokenDecimals: number;
  minBalance: bigint; // Minimum balance to sweep (in wei)
  explorerUrl: string;
  rpcEnvKey: string;
  enabled: boolean;
  isTestnet: boolean;
  // BSC requires viem for EIP-7702 (not Foundry cast)
  requiresViem7702: boolean;
}

// Unichain definitions (not in viem yet)
const unichain: Chain = {
  id: 130,
  name: 'Unichain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.unichain.org'] } },
  blockExplorers: { default: { name: 'Uniscan', url: 'https://uniscan.xyz' } },
};

const unichainSepolia: Chain = {
  id: 1301,
  name: 'Unichain Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.unichain.org'] } },
  blockExplorers: { default: { name: 'Uniscan', url: 'https://sepolia.uniscan.xyz' } },
  testnet: true,
};

// Berachain Bepolia (EIP-7702 supported)
const berachainBepolia: Chain = {
  id: 80069,
  name: 'Berachain Bepolia',
  nativeCurrency: { name: 'BERA', symbol: 'BERA', decimals: 18 },
  rpcUrls: { default: { http: ['https://bepolia.rpc.berachain.com'] } },
  blockExplorers: { default: { name: 'Beratrail', url: 'https://bepolia.beratrail.io' } },
  testnet: true,
};

// Plasma Testnet (EIP-7702 supported)
const plasmaTestnet: Chain = {
  id: 9746,
  name: 'Plasma Testnet',
  nativeCurrency: { name: 'XPL', symbol: 'XPL', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.plasma.to'] } },
  blockExplorers: { default: { name: 'Plasma Explorer', url: 'https://testnet-explorer.plasma.to' } },
  testnet: true,
};

// Mantle Sepolia (EIP-7702 supported)
const mantleSepolia: Chain = {
  id: 5003,
  name: 'Mantle Sepolia',
  nativeCurrency: { name: 'MNT', symbol: 'MNT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.sepolia.mantle.xyz'] } },
  blockExplorers: { default: { name: 'Mantle Sepolia Explorer', url: 'https://sepolia.mantlescan.xyz' } },
  testnet: true,
};

// ===== Superchain Testnets (EIP-7702 via Isthmus hardfork) =====

// Ink Sepolia
const inkSepolia: Chain = {
  id: 763373,
  name: 'Ink Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc-gel-sepolia.inkonchain.com'] } },
  blockExplorers: { default: { name: 'Ink Explorer', url: 'https://explorer-sepolia.inkonchain.com' } },
  testnet: true,
};

// Mode Sepolia
const modeSepolia: Chain = {
  id: 919,
  name: 'Mode Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.mode.network'] } },
  blockExplorers: { default: { name: 'Mode Explorer', url: 'https://sepolia.explorer.mode.network' } },
  testnet: true,
};

// Zora Sepolia
const zoraSepolia: Chain = {
  id: 999999999,
  name: 'Zora Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.rpc.zora.energy'] } },
  blockExplorers: { default: { name: 'Zora Explorer', url: 'https://sepolia.explorer.zora.energy' } },
  testnet: true,
};

// Soneium Minato
const soneiumMinato: Chain = {
  id: 1946,
  name: 'Soneium Minato',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.minato.soneium.org'] } },
  blockExplorers: { default: { name: 'Soneium Explorer', url: 'https://explorer-testnet.soneium.org' } },
  testnet: true,
};

// Metal L2 Testnet
const metalL2Testnet: Chain = {
  id: 1740,
  name: 'Metal L2 Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.rpc.metall2.com'] } },
  blockExplorers: { default: { name: 'Metal Explorer', url: 'https://testnet.explorer.metall2.com' } },
  testnet: true,
};

// Lisk Sepolia
const liskSepolia: Chain = {
  id: 4202,
  name: 'Lisk Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.sepolia-api.lisk.com'] } },
  blockExplorers: { default: { name: 'Lisk Explorer', url: 'https://sepolia-blockscout.lisk.com' } },
  testnet: true,
};

// World Chain Sepolia
const worldChainSepolia: Chain = {
  id: 4801,
  name: 'World Chain Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://worldchain-sepolia.g.alchemy.com/public'] } },
  blockExplorers: { default: { name: 'World Chain Explorer', url: 'https://worldchain-sepolia.explorer.alchemy.com' } },
  testnet: true,
};

// All supported chains
export const chains: Record<number, ChainConfig> = {
  // Mainnets
  [mainnet.id]: {
    chain: mainnet,
    name: 'Ethereum',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n, // 0.0001 ETH
    explorerUrl: 'https://etherscan.io',
    rpcEnvKey: 'RPC_URL_ETHEREUM',
    enabled: false, // Disabled until mainnet launch
    isTestnet: false,
    requiresViem7702: false,
  },
  [bsc.id]: {
    chain: bsc,
    name: 'BNB Chain',
    nativeToken: 'BNB',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n, // 0.0001 BNB
    explorerUrl: 'https://bscscan.com',
    rpcEnvKey: 'RPC_URL_BSC',
    enabled: false,
    isTestnet: false,
    requiresViem7702: true, // BSC requires viem for EIP-7702
  },
  [base.id]: {
    chain: base,
    name: 'Base',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://basescan.org',
    rpcEnvKey: 'RPC_URL_BASE',
    enabled: false,
    isTestnet: false,
    requiresViem7702: false,
  },
  [arbitrum.id]: {
    chain: arbitrum,
    name: 'Arbitrum',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://arbiscan.io',
    rpcEnvKey: 'RPC_URL_ARBITRUM',
    enabled: false,
    isTestnet: false,
    requiresViem7702: false,
  },
  [optimism.id]: {
    chain: optimism,
    name: 'Optimism',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://optimistic.etherscan.io',
    rpcEnvKey: 'RPC_URL_OPTIMISM',
    enabled: false,
    isTestnet: false,
    requiresViem7702: false,
  },
  [polygon.id]: {
    chain: polygon,
    name: 'Polygon',
    nativeToken: 'POL',
    nativeTokenDecimals: 18,
    minBalance: 1000000000000000n, // 0.001 POL (cheaper gas)
    explorerUrl: 'https://polygonscan.com',
    rpcEnvKey: 'RPC_URL_POLYGON',
    enabled: false,
    isTestnet: false,
    requiresViem7702: false,
  },
  [gnosis.id]: {
    chain: gnosis,
    name: 'Gnosis',
    nativeToken: 'xDAI',
    nativeTokenDecimals: 18,
    minBalance: 1000000000000000n, // 0.001 xDAI
    explorerUrl: 'https://gnosisscan.io',
    rpcEnvKey: 'RPC_URL_GNOSIS',
    enabled: false,
    isTestnet: false,
    requiresViem7702: false,
  },
  [unichain.id]: {
    chain: unichain,
    name: 'Unichain',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://uniscan.xyz',
    rpcEnvKey: 'RPC_URL_UNICHAIN',
    enabled: false,
    isTestnet: false,
    requiresViem7702: false,
  },

  // Testnets
  [sepolia.id]: {
    chain: sepolia,
    name: 'Sepolia',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://sepolia.etherscan.io',
    rpcEnvKey: 'RPC_URL_SEPOLIA',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
  [bscTestnet.id]: {
    chain: bscTestnet,
    name: 'BSC Testnet',
    nativeToken: 'tBNB',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://testnet.bscscan.com',
    rpcEnvKey: 'RPC_URL_BSC_TESTNET',
    enabled: true,
    isTestnet: true,
    requiresViem7702: true,
  },
  [baseSepolia.id]: {
    chain: baseSepolia,
    name: 'Base Sepolia',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://sepolia.basescan.org',
    rpcEnvKey: 'RPC_URL_BASE_SEPOLIA',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
  [arbitrumSepolia.id]: {
    chain: arbitrumSepolia,
    name: 'Arbitrum Sepolia',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://sepolia.arbiscan.io',
    rpcEnvKey: 'RPC_URL_ARBITRUM_SEPOLIA',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
  [optimismSepolia.id]: {
    chain: optimismSepolia,
    name: 'Optimism Sepolia',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://sepolia-optimism.etherscan.io',
    rpcEnvKey: 'RPC_URL_OPTIMISM_SEPOLIA',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
  [polygonAmoy.id]: {
    chain: polygonAmoy,
    name: 'Polygon Amoy',
    nativeToken: 'POL',
    nativeTokenDecimals: 18,
    minBalance: 1000000000000000n,
    explorerUrl: 'https://amoy.polygonscan.com',
    rpcEnvKey: 'RPC_URL_POLYGON_AMOY',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
  [gnosisChiado.id]: {
    chain: gnosisChiado,
    name: 'Gnosis Chiado',
    nativeToken: 'xDAI',
    nativeTokenDecimals: 18,
    minBalance: 1000000000000000n,
    explorerUrl: 'https://gnosis-chiado.blockscout.com',
    rpcEnvKey: 'RPC_URL_GNOSIS_CHIADO',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
  [unichainSepolia.id]: {
    chain: unichainSepolia,
    name: 'Unichain Sepolia',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://sepolia.uniscan.xyz',
    rpcEnvKey: 'RPC_URL_UNICHAIN_SEPOLIA',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
  [berachainBepolia.id]: {
    chain: berachainBepolia,
    name: 'Berachain Bepolia',
    nativeToken: 'BERA',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n, // 0.0001 BERA
    explorerUrl: 'https://bepolia.beratrail.io',
    rpcEnvKey: 'RPC_URL_BERACHAIN_BEPOLIA',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
  [plasmaTestnet.id]: {
    chain: plasmaTestnet,
    name: 'Plasma Testnet',
    nativeToken: 'XPL',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n, // 0.0001 XPL
    explorerUrl: 'https://testnet-explorer.plasma.to',
    rpcEnvKey: 'RPC_URL_PLASMA_TESTNET',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
  [mantleSepolia.id]: {
    chain: mantleSepolia,
    name: 'Mantle Sepolia',
    nativeToken: 'MNT',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n, // 0.0001 MNT
    explorerUrl: 'https://sepolia.mantlescan.xyz',
    rpcEnvKey: 'RPC_URL_MANTLE_SEPOLIA',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },

  // ===== Superchain Testnets =====
  [inkSepolia.id]: {
    chain: inkSepolia,
    name: 'Ink Sepolia',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://explorer-sepolia.inkonchain.com',
    rpcEnvKey: 'RPC_URL_INK_SEPOLIA',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
  [modeSepolia.id]: {
    chain: modeSepolia,
    name: 'Mode Sepolia',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://sepolia.explorer.mode.network',
    rpcEnvKey: 'RPC_URL_MODE_SEPOLIA',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
  [zoraSepolia.id]: {
    chain: zoraSepolia,
    name: 'Zora Sepolia',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://sepolia.explorer.zora.energy',
    rpcEnvKey: 'RPC_URL_ZORA_SEPOLIA',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
  [soneiumMinato.id]: {
    chain: soneiumMinato,
    name: 'Soneium Minato',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://explorer-testnet.soneium.org',
    rpcEnvKey: 'RPC_URL_SONEIUM_MINATO',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
  [metalL2Testnet.id]: {
    chain: metalL2Testnet,
    name: 'Metal L2 Testnet',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://testnet.explorer.metall2.com',
    rpcEnvKey: 'RPC_URL_METAL_TESTNET',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
  [liskSepolia.id]: {
    chain: liskSepolia,
    name: 'Lisk Sepolia',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://sepolia-blockscout.lisk.com',
    rpcEnvKey: 'RPC_URL_LISK_SEPOLIA',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
  [worldChainSepolia.id]: {
    chain: worldChainSepolia,
    name: 'World Chain Sepolia',
    nativeToken: 'ETH',
    nativeTokenDecimals: 18,
    minBalance: 100000000000000n,
    explorerUrl: 'https://worldchain-sepolia.explorer.alchemy.com',
    rpcEnvKey: 'RPC_URL_WORLDCHAIN_SEPOLIA',
    enabled: true,
    isTestnet: true,
    requiresViem7702: false,
  },
};

export function getEnabledChains(testnet: boolean = true): ChainConfig[] {
  return Object.values(chains).filter(c => c.enabled && c.isTestnet === testnet);
}

export function getChainConfig(chainId: number): ChainConfig | undefined {
  return chains[chainId];
}

export function isChainSupported(chainId: number): boolean {
  const chain = chains[chainId];
  return chain !== undefined && chain.enabled;
}
