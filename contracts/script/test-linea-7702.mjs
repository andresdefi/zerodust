import { createWalletClient, createPublicClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const lineaSepolia = defineChain({
  id: 59141,
  name: 'Linea Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.sepolia.linea.build'] },
  },
  blockExplorers: {
    default: { name: 'Lineascan', url: 'https://sepolia.lineascan.build' },
  },
});

const PRIVATE_KEY = process.env.PRIVATE_KEY;

async function testEIP7702() {
  console.log('Testing EIP-7702 on Linea Sepolia (chain 59141)...');
  
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log('Account:', account.address);
  
  const publicClient = createPublicClient({
    chain: lineaSepolia,
    transport: http(),
  });
  
  const balance = await publicClient.getBalance({ address: account.address });
  console.log('Balance:', balance, 'wei');
  
  const walletClient = createWalletClient({
    account,
    chain: lineaSepolia,
    transport: http(),
  });
  
  try {
    console.log('Signing EIP-7702 authorization...');
    const authorization = await walletClient.signAuthorization({
      contractAddress: '0x0000000000000000000000000000000000000001',
    });
    console.log('Authorization signed successfully');
    
    console.log('Sending EIP-7702 transaction...');
    const hash = await walletClient.sendTransaction({
      to: account.address,
      value: 0n,
      authorizationList: [authorization],
      gas: 500000n,
      maxFeePerGas: 3000000000n,
      maxPriorityFeePerGas: 1000000000n,
    });
    
    console.log('TX Hash:', hash);
    console.log('Waiting for receipt...');
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log('Receipt status:', receipt.status);
    
    if (receipt.status === 'success') {
      console.log('\n✅ EIP-7702 SUPPORTED on Linea Sepolia!');
    } else {
      console.log('\n❌ Transaction failed');
    }
  } catch (error) {
    console.log('\nError:', error.shortMessage || error.message.substring(0, 300));
    
    if (error.message.includes('transaction type not supported') || 
        error.message.includes('unsupported tx type') ||
        error.message.includes('not enabled') ||
        error.message.includes('unknown transaction type') ||
        error.message.includes('invalid transaction type')) {
      console.log('\n❌ EIP-7702 NOT SUPPORTED on Linea Sepolia (yet)');
    }
  }
}

testEIP7702();
