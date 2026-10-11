/**
 * Cross-chain sweep: empty one chain and deliver the native gas of another.
 * Dry run by default (real quote and signatures, nothing submitted); set SEND=1 to sweep.
 *
 * Usage: ZERODUST_PRIVATE_KEY=0x... FROM_CHAIN_ID=42161 TO_CHAIN_ID=8453 npx tsx examples/cross-chain-sweep.ts
 * DESTINATION defaults to the same address on the destination chain.
 */
import { ZeroDustAgent } from '@zerodust/sdk';
import { privateKeyToAccount } from 'viem/accounts';

async function main(): Promise<void> {
  const key = process.env.ZERODUST_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) {
    console.error('Set ZERODUST_PRIVATE_KEY');
    process.exit(1);
  }
  const fromChainId = Number(process.env.FROM_CHAIN_ID ?? 42161);
  const toChainId = Number(process.env.TO_CHAIN_ID ?? 8453);
  const destination = process.env.DESTINATION as `0x${string}` | undefined;

  const agent = new ZeroDustAgent({ account: privateKeyToAccount(key), environment: 'mainnet' });
  const dryRun = process.env.SEND !== '1';

  const result = await agent.sweep({ fromChainId, toChainId, ...(destination ? { destination } : {}) }, { dryRun });
  if (!result.success) {
    console.error('Not swept:', result.error);
    process.exit(1);
  }
  console.log(dryRun
    ? `Dry run OK: at least ${result.quote?.estimatedReceive} wei arrives on chain ${toChainId}; run with SEND=1 to sweep`
    : `Swept: ${result.sweepId}, tx ${result.txHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
