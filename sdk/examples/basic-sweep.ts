/**
 * Same-chain sweep: empty one chain to another address on that chain.
 * Dry run by default (real quote and signatures, nothing submitted); set SEND=1 to sweep.
 *
 * Usage: ZERODUST_PRIVATE_KEY=0x... CHAIN_ID=8453 DESTINATION=0x... npx tsx examples/basic-sweep.ts
 */
import { ZeroDustAgent } from '@zerodust/sdk';
import { privateKeyToAccount } from 'viem/accounts';

async function main(): Promise<void> {
  const key = process.env.ZERODUST_PRIVATE_KEY as `0x${string}` | undefined;
  const destination = process.env.DESTINATION as `0x${string}` | undefined;
  const chainId = Number(process.env.CHAIN_ID ?? 8453);
  if (!key || !destination) {
    console.error('Set ZERODUST_PRIVATE_KEY and DESTINATION (another address: a same-chain sweep cannot go to itself)');
    process.exit(1);
  }

  const agent = new ZeroDustAgent({ account: privateKeyToAccount(key), environment: 'mainnet' });
  const dryRun = process.env.SEND !== '1';

  const result = await agent.sweep({ fromChainId: chainId, toChainId: chainId, destination }, { dryRun });
  if (!result.success) {
    console.error('Not swept:', result.error);
    process.exit(1);
  }
  console.log(dryRun
    ? `Dry run OK: would deliver at least ${result.quote?.estimatedReceive} wei; run with SEND=1 to sweep`
    : `Swept: ${result.sweepId}, tx ${result.txHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
