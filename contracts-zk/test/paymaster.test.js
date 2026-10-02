// ZeroDustPaymaster on a local ZKsync node (anvil-zksync, started by @matterlabs/hardhat-zksync).
// The property under test: a wallet that sends a fee transaction and a sweep transaction whose
// values add up to its balance ends at exactly 0 wei, the paymaster paying all gas.
const { expect } = require('chai');
const hre = require('hardhat');
const { Wallet, Provider, utils, types } = require('zksync-ethers');
const { ethers } = require('ethers');

const GAS_LIMIT = 2_000_000n;

/** zksync-ethers' Wallet.createRandom returns a plain ethers wallet: wrap a fresh key instead */
const randomWallet = (provider) => new Wallet(ethers.Wallet.createRandom().privateKey, provider);

/** The promise must reject (the node refuses the transaction or it reverts) */
/**
 * Waits for a sent transaction through the provider (zksync-ethers' response.wait() never resolves
 * on the local node) and throws if it reverted
 */
let provider;
async function mined(sent, timeoutMs = 60_000) {
  const tx = await sent;
  const r = await provider.waitForTransaction(tx.hash, 1, timeoutMs);
  if (!r || r.status !== 1) throw new Error(`reverted: ${tx.hash}`);
  return r;
}

/** The node refuses it at once, or drops it (paymaster validation failed): either way it never mines */
async function expectRejected(promise) {
  let failed = false;
  try { await promise; } catch { failed = true; }
  expect(failed, 'expected the transaction to be refused').to.equal(true);
}

describe('ZeroDustPaymaster', function () {
  this.timeout(300_000);
  let rich, approver, paymaster, chainId;

  before(async () => {
    provider = new Provider(hre.network.config.url);
    chainId = Number((await provider.getNetwork()).chainId);
    // The local node's pre-funded account (the plugin's default wallet; it also deploys)
    rich = (await hre.zksyncEthers.getWallet()).connect(provider);
    approver = randomWallet(provider);
    const artifact = await hre.deployer.loadArtifact('ZeroDustPaymaster');
    const deployed = await hre.deployer.deploy(artifact, [rich.address, approver.address]);
    paymaster = await deployed.getAddress();
    // Float
    await mined(rich.sendTransaction({ to: paymaster, value: ethers.parseEther('0.05') }));
  });

  async function fundedUser(amount) {
    const user = randomWallet(provider);
    await mined(rich.sendTransaction({ to: user.address, value: amount }));
    return user;
  }

  async function approve(signer, tx) {
    const domain = { name: 'ZeroDust Paymaster', version: '1', chainId, verifyingContract: paymaster };
    const typesDef = {
      Approval: [
        { name: 'from', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' }, { name: 'dataHash', type: 'bytes32' }, { name: 'maxGasCost', type: 'uint256' },
      ],
    };
    return signer.signTypedData(domain, typesDef, {
      from: tx.from, nonce: tx.nonce, to: tx.to, value: tx.value, dataHash: ethers.keccak256(tx.data ?? '0x'),
      maxGasCost: tx.maxGasCost ?? tx.gasLimit * tx.maxFeePerGas,
    });
  }

  /** A type-113 tx naming the paymaster, approved by `signer`, sent from `user` */
  async function send(user, { to, value, data = '0x', nonce, signer = approver, gasLimit = GAS_LIMIT, quick = false }) {
    const maxFeePerGas = (await provider.getGasPrice()) * 2n;
    const tx = { from: user.address, to, value, data, nonce: nonce ?? (await user.getNonce()), gasLimit, maxFeePerGas };
    const signature = await approve(signer, tx);
    const paymasterParams = utils.getPaymasterParams(paymaster, { type: 'General', innerInput: ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'bytes'], [tx.gasLimit * tx.maxFeePerGas, signature]) });
    return mined(user.sendTransaction({
      ...tx, type: utils.EIP712_TX_TYPE, maxPriorityFeePerGas: 0n,
      customData: { gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT, paymasterParams },
    }), quick ? 15_000 : 60_000);
  }

  /**
   * Why the paymaster refuses a transaction: the node runs paymaster validation in a gas estimate
   * (at its maximum gas), so the approval allows a huge gas cost to let the real check speak
   */
  async function refusal(user, { to, value, data = '0x', signer = approver, maxGasCost = ethers.parseEther('1000000') }) {
    const maxFeePerGas = (await provider.getGasPrice()) * 2n;
    const tx = { from: user.address, to, value, data, nonce: await user.getNonce(), maxGasCost };
    const signature = await approve(signer, tx);
    const paymasterParams = utils.getPaymasterParams(paymaster, { type: 'General', innerInput: ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'bytes'], [maxGasCost, signature]) });
    try {
      await provider.estimateGas({ ...tx, maxFeePerGas, type: utils.EIP712_TX_TYPE, customData: { gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT, paymasterParams } });
      return 'accepted';
    } catch (e) {
      const msg = String(e.message);
      const named = msg.match(/Paymaster validation error: (\w+):/)?.[1];
      if (named && named !== 'Error') return named;
      // Some errors arrive only as a selector: map ours back to their names
      const sel = msg.match(/function selector: (0x[0-9a-f]{8})/)?.[1];
      const errors = ['NotBootloader', 'NotOwner', 'UnsupportedFlow', 'BadApproval', 'FeeBelowGas', 'FeeWithData', 'NoCredit', 'BootloaderPaymentFailed', 'ZeroAddress', 'GasAboveApproval'];
      return errors.find((n) => ethers.id(`${n}()`).slice(0, 10) === sel) ?? msg.slice(0, 120);
    }
  }

  it('names the rule each refusal breaks', async () => {
    const user = await fundedUser(ethers.parseEther('0.01'));
    const other = randomWallet(provider).address;
    expect(await refusal(user, { to: other, value: 1n })).to.equal('NoCredit');
    expect(await refusal(user, { to: paymaster, value: ethers.parseEther('0.001'), signer: randomWallet(provider) })).to.equal('BadApproval');
    expect(await refusal(user, { to: paymaster, value: 1n })).to.equal('FeeBelowGas');
    expect(await refusal(user, { to: paymaster, value: ethers.parseEther('0.001'), data: '0x1234' })).to.equal('FeeWithData');
    expect(await refusal(user, { to: paymaster, value: ethers.parseEther('0.001'), maxGasCost: 1n })).to.equal('GasAboveApproval');
  });

  it('sweeps a wallet to exactly 0: fee + sweep values equal the balance, the paymaster pays all gas', async () => {
    const balance = ethers.parseEther('0.0123456789');
    const user = await fundedUser(balance);
    const recipient = Wallet.createRandom().address;
    const maxFee = (await provider.getGasPrice()) * 2n;
    const fee = GAS_LIMIT * maxFee * 2n + ethers.parseEther('0.0001'); // both txs' gas + a service fee
    await send(user, { to: paymaster, value: fee });
    await send(user, { to: recipient, value: balance - fee });
    expect(await provider.getBalance(user.address)).to.equal(0n);
    expect(await provider.getBalance(recipient)).to.equal(balance - fee);
  });

  it('refuses a sweep whose fee was not paid first', async () => {
    const user = await fundedUser(ethers.parseEther('0.01'));
    await expectRejected(send(user, { to: Wallet.createRandom().address, value: ethers.parseEther('0.005') , quick: true }));
    expect(await provider.getBalance(user.address)).to.equal(ethers.parseEther('0.01'));
  });

  it('refuses a transaction not approved by the approver', async () => {
    const user = await fundedUser(ethers.parseEther('0.01'));
    const maxFee = (await provider.getGasPrice()) * 2n;
    await expectRejected(send(user, { to: paymaster, value: GAS_LIMIT * maxFee * 2n, signer: randomWallet(provider) , quick: true }));
  });

  it('refuses a fee below its own gas, and a fee carrying calldata', async () => {
    const user = await fundedUser(ethers.parseEther('0.01'));
    await expectRejected(send(user, { to: paymaster, value: 1n , quick: true }));
    const maxFee = (await provider.getGasPrice()) * 2n;
    await expectRejected(send(user, { to: paymaster, value: GAS_LIMIT * maxFee * 2n, data: '0x1234' , quick: true }));
  });

  it('an approval is bound to the transaction: a different value or recipient is refused', async () => {
    const user = await fundedUser(ethers.parseEther('0.02'));
    const maxFee = (await provider.getGasPrice()) * 2n;
    const fee = GAS_LIMIT * maxFee * 2n;
    await send(user, { to: paymaster, value: fee });
    // Approve sending 0.001 to A, but send 0.002 to A
    const nonce = await user.getNonce();
    const tx = { from: user.address, to: Wallet.createRandom().address, value: ethers.parseEther('0.001'), data: '0x', nonce, gasLimit: GAS_LIMIT, maxFeePerGas: maxFee };
    const signature = await approve(approver, tx);
    const paymasterParams = utils.getPaymasterParams(paymaster, { type: 'General', innerInput: ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'bytes'], [tx.gasLimit * tx.maxFeePerGas, signature]) });
    await expectRejected(mined(user.sendTransaction({ ...tx, value: ethers.parseEther('0.002'), type: utils.EIP712_TX_TYPE, maxPriorityFeePerGas: 0n, customData: { gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT, paymasterParams } }), 15_000));
  });

  it('the contract and an off-chain EIP-712 signer compute the same approval digest', async () => {
    const c = new ethers.Contract(paymaster, ['function approvalDigest(address,uint256,address,uint256,bytes32,uint256) view returns (bytes32)'], provider);
    const v = { from: rich.address, nonce: 7n, to: paymaster, value: 123n, dataHash: ethers.keccak256('0x'), maxGasCost: 456n };
    const domain = { name: 'ZeroDust Paymaster', version: '1', chainId, verifyingContract: paymaster };
    const typesDef = { Approval: [{ name: 'from', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'dataHash', type: 'bytes32' }, { name: 'maxGasCost', type: 'uint256' }] };
    expect(await c.approvalDigest(v.from, v.nonce, v.to, v.value, v.dataHash, v.maxGasCost)).to.equal(ethers.TypedDataEncoder.hash(domain, typesDef, v));
  });

  it('refuses a transaction whose gas exceeds the approved maximum', async () => {
    const user = await fundedUser(ethers.parseEther('0.01'));
    const maxFee = (await provider.getGasPrice()) * 2n;
    const value = GAS_LIMIT * maxFee * 2n;
    const nonce = await user.getNonce();
    const tx = { from: user.address, to: paymaster, value, data: '0x', nonce, gasLimit: GAS_LIMIT, maxFeePerGas: maxFee, maxGasCost: 1n };
    const signature = await approve(approver, tx);
    const paymasterParams = utils.getPaymasterParams(paymaster, { type: 'General', innerInput: ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'bytes'], [1n, signature]) });
    await expectRejected(mined(user.sendTransaction({ to: paymaster, value, data: '0x', nonce, gasLimit: GAS_LIMIT, maxFeePerGas: maxFee, type: utils.EIP712_TX_TYPE, maxPriorityFeePerGas: 0n, customData: { gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT, paymasterParams } }), 15_000));
  });

  it('only the owner can change the approver or withdraw', async () => {
    const c = new ethers.Contract(paymaster, ['function setApprover(address)', 'function withdraw(address,uint256)', 'function approver() view returns (address)'], provider);
    const stranger = await fundedUser(ethers.parseEther('0.01'));
    await expectRejected(mined(c.connect(stranger).setApprover(stranger.address)));
    await expectRejected(mined(c.connect(stranger).withdraw(stranger.address, 1n)));
    const before = await provider.getBalance(paymaster);
    await mined(c.connect(rich).withdraw(rich.address, 1000n));
    expect(await provider.getBalance(paymaster)).to.equal(before - 1000n);
  });
});
