// Testnet end-to-end: deploy ZeroDustPaymaster (or reuse ADDRESS), then sweep a fresh wallet to
// exactly 0 with a fee tx + a sweep tx, approvals signed by the deployer (testnet approver).
// Usage: node scripts/testnet-e2e.js <rpcUrl> [paymasterAddress]   (key from ../contracts/.env)
const fs = require('node:fs');
const { Wallet, Provider, ContractFactory, utils } = require('zksync-ethers');
const { ethers } = require('ethers');

const [rpc, existing] = process.argv.slice(2);
const env = fs.readFileSync(`${__dirname}/../../contracts/.env`, 'utf8');
const pk = env.match(/^PRIVATE_KEY=(.*)$/m)[1].trim().replace(/^"|"$/g, '');
const artifact = JSON.parse(fs.readFileSync(`${__dirname}/../artifacts-zk/contracts/ZeroDustPaymaster.sol/ZeroDustPaymaster.json`, 'utf8'));

(async () => {
  const provider = new Provider(rpc);
  const chainId = Number((await provider.getNetwork()).chainId);
  const deployer = new Wallet(pk.startsWith('0x') ? pk : `0x${pk}`, provider);
  const wait = async (sent) => { const t = await sent; const r = await provider.waitForTransaction(t.hash, 1, 180_000); if (!r || r.status !== 1) throw new Error(`reverted ${t.hash}`); return r; };
  let paymaster = existing;
  if (!paymaster) {
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer, 'create');
    const c = await factory.deploy(deployer.address, deployer.address);
    await c.waitForDeployment();
    paymaster = await c.getAddress();
    console.log('deployed paymaster', paymaster);
    await wait(deployer.sendTransaction({ to: paymaster, value: ethers.parseEther('0.002') }));
  }
  const user = new Wallet(ethers.Wallet.createRandom().privateKey, provider);
  const balance = ethers.parseEther(process.env.BALANCE ?? '0.0011');
  await wait(deployer.sendTransaction({ to: user.address, value: balance }));
  const recipient = deployer.address;
  const domain = { name: 'ZeroDust Paymaster', version: '1', chainId, verifyingContract: paymaster };
  const types = { Approval: [{ name: 'from', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'dataHash', type: 'bytes32' }, { name: 'maxGasCost', type: 'uint256' }] };
  const gasLimit = 1_000_000n;
  const maxFeePerGas = (await provider.getGasPrice()) * 2n;
  const maxGasCost = gasLimit * maxFeePerGas;
  const send = async (to, value, nonce) => {
    const signature = await deployer.signTypedData(domain, types, { from: user.address, nonce, to, value, dataHash: ethers.keccak256('0x'), maxGasCost });
    const paymasterParams = utils.getPaymasterParams(paymaster, { type: 'General', innerInput: ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'bytes'], [maxGasCost, signature]) });
    return wait(user.sendTransaction({ to, value, data: '0x', nonce, gasLimit, maxFeePerGas, maxPriorityFeePerGas: 0n, type: utils.EIP712_TX_TYPE, customData: { gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT, paymasterParams } }));
  };
  const fee = maxGasCost * 2n + ethers.parseEther('0.00001');
  const pmBefore = await provider.getBalance(paymaster);
  const r1 = await send(paymaster, fee, 0);
  const r2 = await send(recipient, balance - fee, 1);
  console.log('chain', chainId, 'fee tx', r1.hash, 'sweep tx', r2.hash);
  console.log('user balance after:', (await provider.getBalance(user.address)).toString(), '(must be 0)');
  console.log('paymaster float change:', ethers.formatEther((await provider.getBalance(paymaster)) - pmBefore), 'ETH');
})().catch((e) => { console.error('FAILED', e.shortMessage ?? e.message); process.exit(1); });
