import { createWalletClient, createPublicClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const taikoHoodi = defineChain({
  id: 167013,
  name: 'Taiko Hoodi',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.hoodi.taiko.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Taikoscan', url: 'https://hoodi.taikoscan.io' },
  },
});

const PRIVATE_KEY = process.env.PRIVATE_KEY;

async function testEIP7702() {
  console.log('Testing EIP-7702 on Taiko Hoodi (chain 167013)...');
  console.log('Note: Taiko may be slow, please be patient...');
  
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log('Account:', account.address);
  
  const publicClient = createPublicClient({
    chain: taikoHoodi,
    transport: http(),
  });
  
  const balance = await publicClient.getBalance({ address: account.address });
  console.log('Balance:', (Number(balance) / 1e18).toFixed(4), 'ETH');
  
  const walletClient = createWalletClient({
    account,
    chain: taikoHoodi,
    transport: http(),
  });
  
  try {
    console.log('\nSigning EIP-7702 authorization...');
    const authorization = await walletClient.signAuthorization({
      contractAddress: '0x0000000000000000000000000000000000000001',
    });
    console.log('Authorization signed');
    
    console.log('Sending EIP-7702 transaction...');
    const hash = await walletClient.sendTransaction({
      to: account.address,
      value: 0n,
      authorizationList: [authorization],
      gas: 500000n,
      maxFeePerGas: 1000000000n,  // 1 gwei
      maxPriorityFeePerGas: 100000000n,  // 0.1 gwei
    });
    
    console.log('TX Hash:', hash);
    console.log('Explorer: https://hoodi.taikoscan.io/tx/' + hash);
    console.log('\nWaiting for receipt (this may take a while)...');
    
    const receipt = await publicClient.waitForTransactionReceipt({ 
      hash,
      timeout: 180000, // 3 minutes
    });
    console.log('Status:', receipt.status);
    console.log('Block:', receipt.blockNumber.toString());
    console.log('Gas used:', receipt.gasUsed.toString());
    
    if (receipt.status === 'success') {
      console.log('\n✅ EIP-7702 SUPPORTED on Taiko Hoodi!');
    } else {
      console.log('\n❌ Transaction failed');
    }
  } catch (error) {
    console.log('\nError:', error.shortMessage || error.message.substring(0, 500));
    
    if (error.message.includes('transaction type not supported') || 
        error.message.includes('unsupported tx type') ||
        error.message.includes('not enabled') ||
        error.message.includes('unknown transaction type')) {
      console.log('\n❌ EIP-7702 NOT SUPPORTED on Taiko Hoodi');
    } else if (error.message.includes('Timed out')) {
      console.log('\n⏳ Transaction submitted but confirmation timed out');
      console.log('Check explorer manually for status');
    }
  }
}

testEIP7702();
