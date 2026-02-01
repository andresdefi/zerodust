# ZeroDust SDK Examples

Practical examples demonstrating how to use the ZeroDust SDK.

## Prerequisites

1. Install dependencies from the SDK root:
   ```bash
   npm install
   ```

2. Install tsx for running TypeScript:
   ```bash
   npm install -D tsx
   ```

3. Get testnet ETH:
   - Base Sepolia: https://www.alchemy.com/faucets/base-sepolia
   - Arbitrum Sepolia: https://www.alchemy.com/faucets/arbitrum-sepolia

## Examples

### Check Balances

Check a wallet's native token balances across all supported chains.

```bash
npx tsx examples/check-balances.ts 0xYourAddress
```

This will show:
- Sweepable balances (above minimum threshold)
- Balances too small to sweep
- Summary with total USD value

### Basic Same-Chain Sweep

Sweep all ETH from Base Sepolia to a destination address on the same chain.

```bash
PRIVATE_KEY=0x... npx tsx examples/basic-sweep.ts
```

The example:
1. Checks your balance
2. Gets a quote with fee breakdown
3. Signs the EIP-712 authorization
4. Signs the EIP-7702 delegation
5. Submits the sweep
6. Waits for completion

### Cross-Chain Sweep

Sweep ETH from Arbitrum Sepolia to Base Sepolia (or any supported chain pair).

```bash
PRIVATE_KEY=0x... npx tsx examples/cross-chain-sweep.ts

# Optional: Send to a different address
PRIVATE_KEY=0x... DESTINATION=0x... npx tsx examples/cross-chain-sweep.ts
```

This demonstrates:
- Cross-chain quote with bridge fees
- Longer polling timeout for bridge confirmation
- Status updates during the bridge process

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PRIVATE_KEY` | Yes* | Wallet private key (for sweep examples) |
| `DESTINATION` | No | Override destination address |

*Not required for check-balances example.

## Security Notes

- Never commit your private key to git
- Use a dedicated testnet wallet for testing
- The examples use testnet by default (safe for experimentation)

## Customization

To modify chain IDs or other settings, edit the constants at the top of each example file:

```typescript
// Configuration
const CHAIN_ID = 84532; // Base Sepolia
const DESTINATION = '0x...';
```

## Mainnet Usage

To use on mainnet, change the environment in the SDK initialization:

```typescript
const zerodust = new ZeroDust({
  environment: 'mainnet', // Change from 'testnet'
});
```

And update the chain configuration to use mainnet chain IDs (e.g., 8453 for Base instead of 84532 for Base Sepolia).
