require('@matterlabs/hardhat-zksync');
const fs = require('node:fs');

const LOCAL_ZKSOLC = './bin/zksolc-macosx-arm64-v1.5.18';

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  // zksolc 1.5.18: the release binary in bin/ when present (the plugin's downloader fails on
  // Node 25 locally); otherwise the plugin downloads it (CI, Node 22)
  zksolc: fs.existsSync(LOCAL_ZKSOLC)
    ? { compilerSource: 'binary', settings: { compilerPath: LOCAL_ZKSOLC, codegen: 'yul' } }
    : { version: '1.5.18', settings: { codegen: 'yul' } },
  solidity: { version: '0.8.28', settings: { evmVersion: 'cancun' } },
  defaultNetwork: 'inMemoryNode',
  networks: {
    hardhat: { zksync: true },
    inMemoryNode: { url: 'http://127.0.0.1:8011', ethNetwork: '', zksync: true },
    zkSyncSepolia: { url: 'https://sepolia.era.zksync.dev', ethNetwork: 'sepolia', zksync: true },
  },
};
