require('@matterlabs/hardhat-zksync');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  zksolc: { compilerSource: 'binary', settings: { compilerPath: './bin/zksolc-macosx-arm64-v1.5.18', codegen: 'yul' } }, // zksolc 1.5.18, downloaded from GitHub (the plugin's downloader fails on Node 25)
  solidity: { version: '0.8.28', settings: { evmVersion: 'cancun' } },
  defaultNetwork: 'inMemoryNode',
  networks: {
    hardhat: { zksync: true },
    inMemoryNode: { url: 'http://127.0.0.1:8011', ethNetwork: '', zksync: true },
    zkSyncSepolia: { url: 'https://sepolia.era.zksync.dev', ethNetwork: 'sepolia', zksync: true },
  },
};
