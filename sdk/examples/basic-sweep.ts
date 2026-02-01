/**
 * Example: Basic Same-Chain Sweep
 *
 * This example demonstrates a complete same-chain sweep flow:
 * 1. Get a quote
 * 2. Sign the authorization
 * 3. Submit the sweep
 * 4. Wait for completion
 *
 * Run: PRIVATE_KEY=0x... npx tsx examples/basic-sweep.ts
 */

import { createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { ZeroDust, isZeroDustError } from '../src/index.js';

// Configuration
const CHAIN_ID = 84532; // Base Sepolia
const DESTINATION = '0x000000000000000000000000000000000000dEaD'; // Burn address for demo

async function main() {
  // Get private key from environment
  const privateKey = process.env.PRIVATE_KEY as `0x${string}`;

  if (!privateKey) {
    console.error('Error: PRIVATE_KEY environment variable is required');
    console.error('Usage: PRIVATE_KEY=0x... npx tsx examples/basic-sweep.ts');
    process.exit(1);
  }

  // Set up wallet
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });

  console.log(`\nWallet address: ${account.address}`);
  console.log(`Destination: ${DESTINATION}`);
  console.log(`Chain: Base Sepolia (${CHAIN_ID})\n`);

  // Initialize SDK
  const zerodust = new ZeroDust({
    environment: 'testnet',
  });

  try {
    // Step 1: Check balance
    console.log('Step 1: Checking balance...');
    const balance = await zerodust.getBalance(account.address, CHAIN_ID);
    console.log(`  Balance: ${balance.balanceFormatted}`);

    if (!balance.isSweepable) {
      console.log('  Balance is too low to sweep. Need more funds.');
      process.exit(0);
    }

    // Step 2: Get quote
    console.log('\nStep 2: Getting quote...');
    const quote = await zerodust.getQuote({
      fromChainId: CHAIN_ID,
      toChainId: CHAIN_ID,
      userAddress: account.address,
      destination: DESTINATION,
    });

    console.log(`  Quote ID: ${quote.quoteId}`);
    console.log(`  Balance: ${formatEther(BigInt(quote.balanceWei))} ETH`);
    console.log(`  You receive: ${formatEther(BigInt(quote.minReceiveWei))} ETH`);
    console.log(`  Service fee: ${formatEther(BigInt(quote.fees.serviceFeeWei))} ETH`);
    console.log(`  Gas reimbursement: ${formatEther(BigInt(quote.fees.gasReimbursementWei))} ETH`);
    console.log(`  Expires: ${quote.expiresAt}`);

    // Step 3: Create authorization
    console.log('\nStep 3: Creating authorization...');
    const { typedData, eip7702 } = await zerodust.createAuthorization(quote.quoteId);
    console.log(`  Contract: ${eip7702.contractAddress}`);
    console.log(`  Nonce: ${eip7702.nonce}`);

    // Step 4: Sign EIP-712 typed data
    console.log('\nStep 4: Signing EIP-712 typed data...');
    const signature = await walletClient.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
    console.log(`  Signature: ${signature.slice(0, 20)}...`);

    // Step 5: Sign EIP-7702 authorization
    console.log('\nStep 5: Signing EIP-7702 authorization...');
    const eip7702Auth = await walletClient.signAuthorization({
      contractAddress: eip7702.contractAddress as `0x${string}`,
      chainId: eip7702.chainId,
      nonce: eip7702.nonce,
    });
    console.log(`  Authorization signed`);

    // Step 6: Submit sweep
    console.log('\nStep 6: Submitting sweep...');
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

    // Step 7: Wait for completion
    console.log('\nStep 7: Waiting for completion...');
    const result = await zerodust.waitForSweep(sweep.sweepId, {
      intervalMs: 2000,
      timeoutMs: 120000,
      onStatusChange: (status) => {
        console.log(`  Status: ${status.status}`);
      },
    });

    if (result.status === 'completed') {
      console.log('\n=== Sweep Completed ===');
      console.log(`  TX Hash: ${result.txHash}`);
      console.log(`  Amount swept: ${result.amountSwept ? formatEther(BigInt(result.amountSwept)) : 'N/A'} ETH`);
    } else {
      console.log('\n=== Sweep Failed ===');
      console.log(`  Error: ${result.errorMessage}`);
    }
  } catch (error) {
    if (isZeroDustError(error)) {
      console.error('\nZeroDust Error:');
      console.error(`  Code: ${error.code}`);
      console.error(`  Message: ${error.getUserMessage()}`);
      if (error.details) {
        console.error(`  Details:`, error.details);
      }
    } else {
      console.error('\nUnexpected error:', error);
    }
    process.exit(1);
  }
}

main();
