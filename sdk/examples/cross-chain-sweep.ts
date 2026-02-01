/**
 * Example: Cross-Chain Sweep
 *
 * This example demonstrates sweeping from one chain to another:
 * - Sweep ETH from Arbitrum Sepolia to Base Sepolia
 * - Uses Gas.zip bridge for cross-chain transfer
 *
 * Run: PRIVATE_KEY=0x... npx tsx examples/cross-chain-sweep.ts
 */

import { createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { ZeroDust, isZeroDustError } from '../src/index.js';

// Configuration
const FROM_CHAIN_ID = 421614; // Arbitrum Sepolia
const TO_CHAIN_ID = 84532; // Base Sepolia

async function main() {
  // Get private key from environment
  const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  // Destination defaults to same address, but can be overridden
  const destination = process.env.DESTINATION as `0x${string}` | undefined;

  if (!privateKey) {
    console.error('Error: PRIVATE_KEY environment variable is required');
    console.error('Usage: PRIVATE_KEY=0x... npx tsx examples/cross-chain-sweep.ts');
    console.error('Optional: DESTINATION=0x... to send to a different address');
    process.exit(1);
  }

  // Set up wallet
  const account = privateKeyToAccount(privateKey);
  const finalDestination = destination || account.address;

  const walletClient = createWalletClient({
    account,
    chain: arbitrumSepolia,
    transport: http(),
  });

  console.log(`\n=== Cross-Chain Sweep ===`);
  console.log(`From: Arbitrum Sepolia (${FROM_CHAIN_ID})`);
  console.log(`To: Base Sepolia (${TO_CHAIN_ID})`);
  console.log(`Wallet: ${account.address}`);
  console.log(`Destination: ${finalDestination}\n`);

  // Initialize SDK
  const zerodust = new ZeroDust({
    environment: 'testnet',
  });

  try {
    // Step 1: Check source chain balance
    console.log('Step 1: Checking source chain balance...');
    const balance = await zerodust.getBalance(account.address, FROM_CHAIN_ID);
    console.log(`  Balance on Arbitrum Sepolia: ${balance.balanceFormatted}`);

    if (!balance.isSweepable) {
      console.log('  Balance is too low to sweep.');
      console.log('  Get testnet ETH from: https://www.alchemy.com/faucets/arbitrum-sepolia');
      process.exit(0);
    }

    // Step 2: Get cross-chain quote
    console.log('\nStep 2: Getting cross-chain quote...');
    const quote = await zerodust.getQuote({
      fromChainId: FROM_CHAIN_ID,
      toChainId: TO_CHAIN_ID,
      userAddress: account.address,
      destination: finalDestination,
    });

    console.log(`  Quote ID: ${quote.quoteId}`);
    console.log(`  Balance: ${formatEther(BigInt(quote.balanceWei))} ETH`);
    console.log(`  You receive on Base: ${formatEther(BigInt(quote.minReceiveWei))} ETH`);
    console.log(`  Fees breakdown:`);
    console.log(`    Service fee: ${formatEther(BigInt(quote.fees.serviceFeeWei))} ETH`);
    console.log(`    Gas reimbursement: ${formatEther(BigInt(quote.fees.gasReimbursementWei))} ETH`);
    console.log(`    Bridge fee: ${formatEther(BigInt(quote.fees.bridgeFeeWei))} ETH`);
    console.log(`    Total: ${formatEther(BigInt(quote.fees.totalFeeWei))} ETH`);
    console.log(`  Expires: ${quote.expiresAt}`);

    // Step 3: Create authorization
    console.log('\nStep 3: Creating authorization...');
    const { typedData, eip7702 } = await zerodust.createAuthorization(quote.quoteId);
    console.log(`  Contract: ${eip7702.contractAddress}`);

    // Step 4: Sign EIP-712 typed data
    console.log('\nStep 4: Signing EIP-712 typed data...');
    const signature = await walletClient.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
    console.log(`  Signature obtained`);

    // Step 5: Sign EIP-7702 authorization
    console.log('\nStep 5: Signing EIP-7702 authorization...');
    const eip7702Auth = await walletClient.signAuthorization({
      contractAddress: eip7702.contractAddress as `0x${string}`,
      chainId: eip7702.chainId,
      nonce: eip7702.nonce,
    });
    console.log(`  Authorization signed`);

    // Step 6: Submit sweep
    console.log('\nStep 6: Submitting cross-chain sweep...');
    const sweep = await zerodust.submitSweep({
      quoteId: quote.quoteId,
      signature,
      eip7702Authorization: {
        chainId: eip7702Auth.chainId,
        contractAddress: eip7702Auth.contractAddress,
        nonce: eip7702Auth.nonce,
        yParity: eip7702Auth.yParity,
        r: eip7702Auth.r,
        s: eip7702Auth.s,
      },
    });
    console.log(`  Sweep ID: ${sweep.sweepId}`);
    console.log(`  Status: ${sweep.status}`);

    // Step 7: Wait for completion (cross-chain takes longer)
    console.log('\nStep 7: Waiting for completion (cross-chain may take a few minutes)...');
    const result = await zerodust.waitForSweep(sweep.sweepId, {
      intervalMs: 3000, // Poll every 3 seconds
      timeoutMs: 300000, // 5 minute timeout for cross-chain
      onStatusChange: (status) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`  [${timestamp}] Status: ${status.status}`);
      },
    });

    if (result.status === 'completed') {
      console.log('\n=== Cross-Chain Sweep Completed ===');
      console.log(`  Source TX: ${result.txHash}`);
      if (result.bridgeTxHash) {
        console.log(`  Bridge TX: ${result.bridgeTxHash}`);
      }
      console.log(`  Funds are now on Base Sepolia at ${finalDestination}`);
    } else {
      console.log('\n=== Sweep Failed ===');
      console.log(`  Error: ${result.errorMessage}`);
    }
  } catch (error) {
    if (isZeroDustError(error)) {
      console.error('\nZeroDust Error:');
      console.error(`  Code: ${error.code}`);
      console.error(`  Message: ${error.getUserMessage()}`);
      if (error.isRetryable()) {
        console.error(`  This error is retryable. Please try again.`);
      }
    } else {
      console.error('\nUnexpected error:', error);
    }
    process.exit(1);
  }
}

main();
