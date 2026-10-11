/**
 * Check which chains hold a native balance for an address (read-only, no key).
 *
 * Usage: ADDRESS=0x... npx tsx examples/check-balances.ts
 */
import { ZeroDust } from '@zerodust/sdk';

async function main(): Promise<void> {
  const address = process.env.ADDRESS as `0x${string}` | undefined;
  if (!address) {
    console.error('Set ADDRESS to the wallet to check');
    process.exit(1);
  }

  const zerodust = new ZeroDust({ environment: 'mainnet' });
  const { chains } = await zerodust.getBalances(address);
  const held = chains.filter((c) => BigInt(c.balance) > 0n);

  console.log(`${address}: a balance on ${held.length} of ${chains.length} sponsored chains`);
  for (const c of held) console.log(`  ${c.name} (${c.chainId}): ${c.balanceFormatted} ${c.nativeToken}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
