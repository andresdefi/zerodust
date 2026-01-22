/**
 * Mainnet E2E Test for ZeroDustSweep (V3-style contract deployed as ZeroDustSweep)
 *
 * Tests the mainnet contract with:
 * - User wallet to sweep
 * - KMS sponsor wallet (or private key for testing)
 * - Same-chain sweep (MODE_TRANSFER)
 *
 * Usage:
 *   USER_PK=0x... SPONSOR_PK=0x... DESTINATION=0x... CHAIN_ID=56 node script/mainnet-e2e-test.mjs
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  keccak256,
  encodePacked,
  encodeAbiParameters,
  encodeFunctionData,
  toHex,
  concat,
  hexToBytes,
  pad,
  numberToHex,
} from 'viem';
import { bsc, polygon, base, arbitrum } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// ============ Configuration ============

const CHAINS = {
  56: { chain: bsc, rpc: process.env.RPC_URL_BSC || 'https://bsc-dataseed.binance.org', name: 'BSC' },
  137: { chain: polygon, rpc: process.env.RPC_URL_POLYGON || 'https://polygon-rpc.com', name: 'Polygon' },
  8453: { chain: base, rpc: process.env.RPC_URL_BASE || 'https://mainnet.base.org', name: 'Base' },
  42161: { chain: arbitrum, rpc: process.env.RPC_URL_ARBITRUM || 'https://arb1.arbitrum.io/rpc', name: 'Arbitrum' },
};

// Mainnet contract address (same on all chains via CREATE2)
const CONTRACT_ADDRESS = '0x341B8327486C0cB209716C91CD469E438Ee030A5';

// V3-style ABI (ZeroDustSweep uses sweep() function)
const SWEEP_ABI = [
  {
    name: 'sweep',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'intent',
        type: 'tuple',
        components: [
          { name: 'mode', type: 'uint8' },
          { name: 'user', type: 'address' },
          { name: 'destination', type: 'address' },
          { name: 'destinationChainId', type: 'uint256' },
          { name: 'callTarget', type: 'address' },
          { name: 'routeHash', type: 'bytes32' },
          { name: 'minReceive', type: 'uint256' },
          { name: 'maxTotalFeeWei', type: 'uint256' },
          { name: 'overheadGasUnits', type: 'uint256' },
          { name: 'protocolFeeGasUnits', type: 'uint256' },
          { name: 'extraFeeWei', type: 'uint256' },
          { name: 'reimbGasPriceCapWei', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
      { name: 'signature', type: 'bytes' },
      { name: 'callData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'isSponsor',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
];

// Constants
const MODE_TRANSFER = 0;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

// EIP-712 type hash
const SWEEP_INTENT_TYPEHASH = keccak256(
  toHex('SweepIntent(uint8 mode,address user,address destination,uint256 destinationChainId,address callTarget,bytes32 routeHash,uint256 minReceive,uint256 maxTotalFeeWei,uint256 overheadGasUnits,uint256 protocolFeeGasUnits,uint256 extraFeeWei,uint256 reimbGasPriceCapWei,uint256 deadline,uint256 nonce)')
);

// ============ Helper Functions ============

function buildDomainSeparator(chainId, verifyingContract) {
  const typeHash = keccak256(
    toHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
  );
  const nameHash = keccak256(toHex('ZeroDustSweep'));
  const versionHash = keccak256(toHex('1'));

  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [typeHash, nameHash, versionHash, BigInt(chainId), verifyingContract]
    )
  );
}

function buildStructHash(intent) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'uint8' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
      ],
      [
        SWEEP_INTENT_TYPEHASH,
        intent.mode,
        intent.user,
        intent.destination,
        intent.destinationChainId,
        intent.callTarget,
        intent.routeHash,
        intent.minReceive,
        intent.maxTotalFeeWei,
        intent.overheadGasUnits,
        intent.protocolFeeGasUnits,
        intent.extraFeeWei,
        intent.reimbGasPriceCapWei,
        intent.deadline,
        intent.nonce,
      ]
    )
  );
}

// ============ Main Test ============

async function main() {
  console.log('=== ZeroDust Mainnet E2E Test ===\n');

  // Parse environment
  const userPK = process.env.USER_PK;
  const sponsorPK = process.env.SPONSOR_PK;
  const destination = process.env.DESTINATION;
  const chainId = parseInt(process.env.CHAIN_ID || '56', 10);

  if (!userPK) {
    console.error('ERROR: USER_PK not set');
    process.exit(1);
  }
  if (!sponsorPK) {
    console.error('ERROR: SPONSOR_PK not set');
    process.exit(1);
  }
  if (!destination) {
    console.error('ERROR: DESTINATION not set');
    process.exit(1);
  }

  const chainConfig = CHAINS[chainId];
  if (!chainConfig) {
    console.error(`ERROR: Unsupported chain ID: ${chainId}`);
    process.exit(1);
  }

  // Setup accounts
  const userAccount = privateKeyToAccount(userPK);
  const sponsorAccount = privateKeyToAccount(sponsorPK);

  console.log(`Chain: ${chainConfig.name} (${chainId})`);
  console.log(`Contract: ${CONTRACT_ADDRESS}`);
  console.log(`User: ${userAccount.address}`);
  console.log(`Sponsor: ${sponsorAccount.address}`);
  console.log(`Destination: ${destination}`);
  console.log('');

  // Create clients
  const publicClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpc),
  });

  const sponsorWallet = createWalletClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpc),
    account: sponsorAccount,
  });

  // Check balances
  const userBalance = await publicClient.getBalance({ address: userAccount.address });
  const sponsorBalance = await publicClient.getBalance({ address: sponsorAccount.address });

  console.log(`User balance: ${formatEther(userBalance)} ${chainConfig.chain.nativeCurrency.symbol}`);
  console.log(`Sponsor balance: ${formatEther(sponsorBalance)} ${chainConfig.chain.nativeCurrency.symbol}`);

  if (userBalance === 0n) {
    console.error('\nERROR: User has no balance to sweep');
    process.exit(1);
  }

  // Verify sponsor is registered in contract
  const isSponsor = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: SWEEP_ABI,
    functionName: 'isSponsor',
    args: [sponsorAccount.address],
  });

  console.log(`\nSponsor registered: ${isSponsor}`);
  if (!isSponsor) {
    console.error('ERROR: Sponsor not registered in contract!');
    process.exit(1);
  }

  // Get current gas price for fee calculation
  const gasPrice = await publicClient.getGasPrice();
  console.log(`Current gas price: ${gasPrice / 1000000000n} gwei`);

  // Build sweep intent
  const overheadGasUnits = 100000n; // Overhead for the sweep
  const protocolFeeGasUnits = 0n; // No protocol fee for testing
  const extraFeeWei = 0n;
  const reimbGasPriceCapWei = (gasPrice * 150n) / 100n; // 1.5x current gas price
  const maxTotalFeeWei = (overheadGasUnits + protocolFeeGasUnits) * reimbGasPriceCapWei + extraFeeWei;

  console.log(`\nFee structure:`);
  console.log(`  Overhead gas: ${overheadGasUnits}`);
  console.log(`  Reimb gas price cap: ${reimbGasPriceCapWei / 1000000000n} gwei`);
  console.log(`  Max total fee: ${formatEther(maxTotalFeeWei)} ${chainConfig.chain.nativeCurrency.symbol}`);

  if (userBalance <= maxTotalFeeWei) {
    console.error(`\nERROR: Balance too low. Need > ${formatEther(maxTotalFeeWei)}`);
    process.exit(1);
  }

  const expectedReceive = userBalance - maxTotalFeeWei;
  console.log(`  Expected receive: ~${formatEther(expectedReceive)} ${chainConfig.chain.nativeCurrency.symbol}`);

  // Get user's transaction nonce for EIP-7702
  const userTxNonce = await publicClient.getTransactionCount({ address: userAccount.address });
  console.log(`\nUser tx nonce: ${userTxNonce}`);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour
  const sweepNonce = 0n; // First sweep for this user

  const intent = {
    mode: MODE_TRANSFER,
    user: userAccount.address,
    destination: destination,
    destinationChainId: BigInt(chainId),
    callTarget: ZERO_ADDRESS,
    routeHash: ZERO_BYTES32,
    minReceive: 0n, // No minimum for testing
    maxTotalFeeWei,
    overheadGasUnits,
    protocolFeeGasUnits,
    extraFeeWei,
    reimbGasPriceCapWei,
    deadline,
    nonce: sweepNonce,
  };

  // Build EIP-712 signature (user signs, verifyingContract = user's EOA for V3)
  console.log('\n1. Building EIP-712 signature...');
  const domainSeparator = buildDomainSeparator(chainId, userAccount.address);
  const structHash = buildStructHash(intent);
  const digest = keccak256(concat(['0x1901', domainSeparator, structHash]));

  const eip712Sig = await userAccount.sign({ hash: digest });
  console.log('   EIP-712 signature created');

  // Sign EIP-7702 authorization (user delegates to contract)
  console.log('\n2. Signing EIP-7702 authorization...');

  const userWallet = createWalletClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpc),
    account: userAccount,
  });

  const authorization = await userWallet.signAuthorization({
    contractAddress: CONTRACT_ADDRESS,
  });
  console.log('   EIP-7702 authorization signed');
  console.log(`   Auth nonce: ${authorization.nonce}`);

  // Encode function call
  const calldata = encodeFunctionData({
    abi: SWEEP_ABI,
    functionName: 'sweep',
    args: [intent, eip712Sig, '0x'], // Empty callData for MODE_TRANSFER
  });

  // Execute sweep
  console.log('\n3. Executing sweep transaction...');
  console.log('   Sending EIP-7702 transaction...');

  try {
    const txHash = await sponsorWallet.sendTransaction({
      to: userAccount.address,
      data: calldata,
      authorizationList: [authorization],
      gas: 300000n,
      // Explicit gas params for BSC compatibility
      maxFeePerGas: reimbGasPriceCapWei,
      maxPriorityFeePerGas: reimbGasPriceCapWei,
    });

    console.log(`   TX Hash: ${txHash}`);

    // Wait for receipt
    console.log('   Waiting for confirmation...');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    console.log(`   Status: ${receipt.status}`);
    console.log(`   Gas used: ${receipt.gasUsed}`);
    console.log(`   Block: ${receipt.blockNumber}`);

    // Check final balances
    const finalUserBalance = await publicClient.getBalance({ address: userAccount.address });
    const finalDestBalance = await publicClient.getBalance({ address: destination });

    console.log('\n=== RESULTS ===');
    console.log(`User start balance: ${formatEther(userBalance)} ${chainConfig.chain.nativeCurrency.symbol}`);
    console.log(`User final balance: ${formatEther(finalUserBalance)} ${chainConfig.chain.nativeCurrency.symbol}`);
    console.log(`Destination received: check explorer`);

    if (finalUserBalance === 0n) {
      console.log('\n✅ SUCCESS! User balance swept to exactly ZERO!');
      console.log(`\nExplorer: ${chainConfig.chain.blockExplorers.default.url}/tx/${txHash}`);
    } else {
      console.log(`\n❌ FAILED - User still has ${formatEther(finalUserBalance)} remaining`);
    }

  } catch (error) {
    console.error('\n❌ Transaction failed:', error.message);
    if (error.details) {
      console.error('Details:', error.details);
    }
    process.exit(1);
  }
}

main().catch(console.error);
