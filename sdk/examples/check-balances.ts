/**
 * Example: Check Balances Across Chains
 *
 * This example shows how to check a user's native token balances
 * across all supported chains and identify sweepable amounts.
 *
 * Run: npx tsx examples/check-balances.ts <address>
 */

import { ZeroDust } from '../src/index.js';

async function main() {
  const address = process.argv[2];

  if (!address) {
    console.error('Usage: npx tsx examples/check-balances.ts <address>');
    console.error('Example: npx tsx examples/check-balances.ts 0x1234...');
    process.exit(1);
  }

  // Initialize SDK (testnet by default)
  const zerodust = new ZeroDust({
    environment: 'testnet',
  });

  console.log(`\nFetching balances for ${address}...\n`);

  try {
    // Get all balances
    const { balances, totalUsd } = await zerodust.getBalances(address);

    // Separate sweepable and non-sweepable
    const sweepable = balances.filter((b) => b.isSweepable);
    const notSweepable = balances.filter((b) => !b.isSweepable && b.balance !== '0');
    const empty = balances.filter((b) => b.balance === '0');

    // Display sweepable balances
    if (sweepable.length > 0) {
      console.log('=== Sweepable Balances ===');
      sweepable.forEach((b) => {
        console.log(`  ${b.chainName} (${b.chainId}): ${b.balanceFormatted}`);
      });
      console.log('');
    }

    // Display balances that are too small to sweep
    if (notSweepable.length > 0) {
      console.log('=== Too Small to Sweep ===');
      notSweepable.forEach((b) => {
        console.log(`  ${b.chainName} (${b.chainId}): ${b.balanceFormatted}`);
      });
      console.log('');
    }

    // Summary
    console.log('=== Summary ===');
    console.log(`  Total chains checked: ${balances.length}`);
    console.log(`  Chains with balance: ${sweepable.length + notSweepable.length}`);
    console.log(`  Sweepable chains: ${sweepable.length}`);
    console.log(`  Empty chains: ${empty.length}`);
    if (totalUsd) {
      console.log(`  Total USD value: $${totalUsd}`);
    }
  } catch (error) {
    console.error('Error fetching balances:', error);
    process.exit(1);
  }
}

main();
