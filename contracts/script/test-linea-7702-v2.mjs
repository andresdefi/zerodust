import { createWalletClient, createPublicClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const lineaSepolia = defineChain({
  id: 59141,
  name: 'Linea Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.sepolia.linea.build'] },
  },
});

const PRIVATE_KEY = process.env.PRIVATE_KEY;

async function testEIP7702() {
  console.log('Testing EIP-7702 on Linea Sepolia with higher gas...');
  
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log('Account:', account.address);
  
  const publicClient = createPublicClient({
    chain: lineaSepolia,
    transport: http(),
  });
  
  const walletClient = createWalletClient({
    account,
    chain: lineaSepolia,
    transport: http(),
  });
  
  // Get current nonce
  const nonce = await publicClient.getTransactionCount({ address: account.address });
  console.log('Current nonce:', nonce);
  
  try {
    console.log('Signing EIP-7702 authorization...');
    const authorization = await walletClient.signAuthorization({
      contractAddress: '0x0000000000000000000000000000000000000001',
    });
    console.log('Authorization signed');
    
    console.log('Sending EIP-7702 transaction with 10x gas...');
    const hash = await walletClient.sendTransaction({
      to: account.address,
      value: 0n,
      nonce: nonce, // Use same nonce to replace pending tx
      authorizationList: [authorization],
      gas: 1000000n,
      maxFeePerGas: 50000000000n,  // 50 gwei - much higher
      maxPriorityFeePerGas: 10000000000n,  // 10 gwei
    });
    
    console.log('TX Hash:', hash);
    console.log('Waiting for receipt (max 60s)...');
    
    const receipt = await publicClient.waitForTransactionReceipt({ 
      hash,
      timeout: 60000,
    });
    console.log('Status:', receipt.status);
    console.log('Gas used:', receipt.gasUsed.toString());
    
    if (receipt.status === 'success') {
      console.log('\n✅ EIP-7702 SUPPORTED on Linea Sepolia!');
      console.log('Explorer: https://sepolia.lineascan.build/tx/' + hash);
    }
  } catch (error) {
    console.log('\nError:', error.shortMessage || error.message.substring(0, 500));
  }
}

testEIP7702();
