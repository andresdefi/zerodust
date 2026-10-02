// Deploys ZeroDustPaymaster with the sponsor KMS address as owner and approver, from the deployer.
// Usage: node scripts/deploy.js <rpcUrl> <floatEth>   (deployer key from ../contracts/.env)
const fs = require('node:fs');
const { Wallet, Provider, ContractFactory } = require('zksync-ethers');
const { ethers } = require('ethers');

const SPONSOR = '0x01eD5c94DE39E73C986b98B85C2c0A3d1BEDff7D';
const [rpc, float] = process.argv.slice(2);
const env = fs.readFileSync(`${__dirname}/../../contracts/.env`, 'utf8');
const pk = env.match(/^PRIVATE_KEY=(.*)$/m)[1].trim().replace(/^"|"$/g, '');
const artifact = JSON.parse(fs.readFileSync(`${__dirname}/../artifacts-zk/contracts/ZeroDustPaymaster.sol/ZeroDustPaymaster.json`, 'utf8'));

(async () => {
  const provider = new Provider(rpc);
  const chainId = Number((await provider.getNetwork()).chainId);
  const deployer = new Wallet(pk.startsWith('0x') ? pk : `0x${pk}`, provider);
  const before = await provider.getBalance(deployer.address);
  const c = await new ContractFactory(artifact.abi, artifact.bytecode, deployer, 'create').deploy(SPONSOR, SPONSOR);
  await c.waitForDeployment();
  const address = await c.getAddress();
  const owner = await c.owner();
  const approver = await c.approver();
  console.log(JSON.stringify({ chainId, paymaster: address, owner, approver, deployTx: c.deploymentTransaction()?.hash, deployCost: ethers.formatEther(before - (await provider.getBalance(deployer.address))) }));
  if (float && Number(float) > 0) {
    const t = await deployer.sendTransaction({ to: address, value: ethers.parseEther(float) });
    await provider.waitForTransaction(t.hash, 1, 180_000);
    console.log('float', ethers.formatEther(await provider.getBalance(address)));
  }
})().catch((e) => { console.error('FAILED', e.shortMessage ?? e.message); process.exit(1); });
