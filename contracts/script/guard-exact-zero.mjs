// End to end on a local anvil: real transactions, with the chain's own gas purchase and refund.
// A wallet holding exactly value + gasLimit x gasPrice sends one legacy tx to ZeroDustGuard; it must
// end at exactly 0 (no unused gas refunded) for every gas limit tried. (No L1 fee on anvil: the L1
// part is checked against real receipts and in the real test on each chain.)
//   anvil --port 8546 &  node script/guard-exact-zero.mjs out/ZeroDustGuard.yul/ZeroDustGuard.json
import { readFileSync } from 'node:fs';
import { createPublicClient, createTestClient, createWalletClient, http, encodeFunctionData, parseAbi, parseEther } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { foundry } from 'viem/chains';

const artifact = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const transport = http('http://127.0.0.1:8546');
const pub = createPublicClient({ chain: foundry, transport });
const test = createTestClient({ chain: foundry, mode: 'anvil', transport });
const deployer = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const wd = createWalletClient({ account: deployer, chain: foundry, transport });
const hash = await wd.deployContract({ abi: [], bytecode: artifact.bytecode.object });
const guard = (await pub.waitForTransactionReceipt({ hash })).contractAddress;
const abi = parseAbi(['function sweep(address target, uint256 fee, bytes data) payable']);
const recipient = '0x00000000000000000000000000000000000000aa';
const price = 2_000_000_000n;
let ok = 0;
for (let i = 0; i < 60; i++) {
  const account = privateKeyToAccount(generatePrivateKey());
  const gas = 100_000n + BigInt(i) * 997n; // above the ~93k a first payment to a new account needs
  const value = parseEther('0.01') + BigInt(i);
  await test.setBalance({ address: account.address, value: value + gas * price });
  const w = createWalletClient({ account, chain: foundry, transport });
  const data = encodeFunctionData({ abi, functionName: 'sweep', args: [recipient, 1000n, '0x'] });
  const h = await w.sendTransaction({ type: 'legacy', to: guard, data, value, gas, gasPrice: price });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  const left = await pub.getBalance({ address: account.address });
  if (r.status === 'success' && left === 0n && r.gasUsed === gas) ok++;
  else console.log(`gas ${gas}: status ${r.status} gasUsed ${r.gasUsed} left ${left}`);
}
// One wei too many: refused, nothing moved but the attempt's gas
const account = privateKeyToAccount(generatePrivateKey());
await test.setBalance({ address: account.address, value: parseEther('0.01') + 1n + 100_000n * price });
const w = createWalletClient({ account, chain: foundry, transport });
const h = await w.sendTransaction({ type: 'legacy', to: guard, data: encodeFunctionData({ abi, functionName: 'sweep', args: [recipient, 0n, '0x'] }), value: parseEther('0.01'), gas: 100_000n, gasPrice: price });
const r = await pub.waitForTransactionReceipt({ hash: h });
console.log(`${ok}/60 sweeps ended at exactly 0 with every unit of gas used; one wei over -> ${r.status}`);
