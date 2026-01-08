import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { zkSyncSepoliaTestnet } from 'viem/chains';

const PRIVATE_KEY = process.env.PRIVATE_KEY;

async function testEIP7702() {
  console.log('Testing EIP-7702 on zkSync Sepolia (chain 300)...');
  
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log('Account:', account.address);
  
  const publicClient = createPublicClient({
    chain: zkSyncSepoliaTestnet,
    transport: http('https://sepolia.era.zksync.dev'),
  });
  
  const balance = await publicClient.getBalance({ address: account.address });
  console.log('Balance:', balance, 'wei');
  
  const walletClient = createWalletClient({
    account,
    chain: zkSyncSepoliaTestnet,
    transport: http('https://sepolia.era.zksync.dev'),
  });
  
  try {
    // Try to sign an EIP-7702 authorization
    console.log('Signing EIP-7702 authorization...');
    const authorization = await walletClient.signAuthorization({
      contractAddress: '0x0000000000000000000000000000000000000001',
    });
    console.log('Authorization signed successfully');
    
    // Try to send a transaction with the authorization
    console.log('Sending EIP-7702 transaction...');
    const hash = await walletClient.sendTransaction({
      to: account.address,
      value: 0n,
      authorizationList: [authorization],
      gas: 500000n,
      maxFeePerGas: 30000000000n,
      maxPriorityFeePerGas: 1000000000n,
    });
    
    console.log('TX Hash:', hash);
    console.log('Waiting for receipt...');
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log('Receipt status:', receipt.status);
    
    if (receipt.status === 'success') {
      console.log('\n✅ EIP-7702 SUPPORTED on zkSync Sepolia!');
    } else {
      console.log('\n❌ Transaction failed - EIP-7702 may not be fully supported');
    }
  } catch (error) {
    console.log('\nError:', error.message);
    console.log('\nShort error:', error.shortMessage || error.message.substring(0, 200));
    
    if (error.message.includes('transaction type not supported') || 
        error.message.includes('unsupported tx type') ||
        error.message.includes('not enabled') ||
        error.message.includes('unknown transaction type') ||
        error.message.includes('Unsupported transaction type')) {
      console.log('\n❌ EIP-7702 NOT SUPPORTED on zkSync Sepolia');
    }
  }
}

testEIP7702();
