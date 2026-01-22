# ZeroDust Smart Contracts

Smart contracts for ZeroDust - an intent-based exit system for sweeping native gas tokens to exactly zero via EIP-7702.

## Overview

ZeroDust V3 enables users to sweep their entire native token balance from any EIP-7702-compatible chain. The sponsor (relayer) executes sweeps on behalf of users, paying gas costs and receiving reimbursement from the swept funds.

**Key Features:**
- Sweep native tokens to exactly 0 balance
- Single unified `SweepIntent` structure for all sweep types
- EIP-7702 sponsored execution (user pays no gas directly)
- Same-chain transfers (MODE_TRANSFER) and cross-chain bridges (MODE_CALL)
- Transparent, granular fee structure
- ERC-7201 namespaced storage for nonce isolation

## Contracts

### ZeroDustSweepMainnet.sol (V3 Production)

Production contract for mainnet deployments.

**Features:**
- Unified `SweepIntent` with 14 fields
- Mode-based execution (0 = transfer, 1 = call)
- Generic `callTarget + callData` pattern for bridges
- Granular fee breakdown (overhead, protocol, extra, gas cap)
- Immutable sponsor addresses
- EIP-712 signatures with user's EOA as verifyingContract

### ZeroDustSweepV3TEST.sol (V3 Testnet)

Testnet contract for development and testing. Identical functionality to mainnet contract.

## V3 Architecture

### SweepIntent Structure

```solidity
struct SweepIntent {
    uint8 mode;                    // 0 = transfer, 1 = call
    address user;                  // User's EOA being swept
    address destination;           // Where funds go (same-chain) or callTarget (cross-chain)
    uint256 destinationChainId;    // Target chain (same as source for same-chain)
    address callTarget;            // Bridge contract (MODE_CALL only)
    bytes32 routeHash;             // keccak256(callData) - binds signature to route
    uint256 minReceive;            // Minimum user receives
    uint256 maxTotalFeeWei;        // Hard cap on total fees
    uint256 overheadGasUnits;      // Gas overhead (50k-300k)
    uint256 protocolFeeGasUnits;   // DEPRECATED - use extraFeeWei
    uint256 extraFeeWei;           // Service fee (5%, $0.05 min, $0.50 max)
    uint256 reimbGasPriceCapWei;   // Gas price cap for reimbursement
    uint256 deadline;              // Signature expiration (unix timestamp)
    uint256 nonce;                 // Per-user nonce
}
```

### Fee Structure

**Service Fee:** 5% of swept value, with $0.05 minimum and $0.50 maximum.

```
Total Fee = Gas Reimbursement + Service Fee + Bridge Fee (if cross-chain)

Where:
- Gas Reimbursement = (overheadGasUnits) × reimbGasPriceCapWei
- Service Fee = min(max(balance × 5%, $0.05), $0.50) → goes in extraFeeWei
- Bridge Fee = Destination chain gas (cross-chain only)
```

### EIP-712 Domain

V3 uses the user's EOA as the `verifyingContract` (EIP-7702 requirement):

```solidity
{
    name: "ZeroDust",
    version: "3",
    chainId: <chain_id>,
    verifyingContract: <user_address>  // User's EOA, not contract
}
```

## Deployments

### Mainnet Deployments (V3)

| Chain | Chain ID | Contract Address | Explorer |
|-------|----------|------------------|----------|
| BSC | 56 | `0x...` | [View](#) |
| Polygon | 137 | `0x...` | [View](#) |
| Arbitrum | 42161 | `0x...` | [View](#) |
| Base | 8453 | `0x...` | [View](#) |

### Testnet Deployments (V3TEST)

| Chain | Chain ID | Contract Address | Explorer |
|-------|----------|------------------|----------|
| Sepolia | 11155111 | `0x8102a8a8029F0dFFC3C5f6528a298437d5D2c2e7` | [View](https://sepolia.etherscan.io/address/0x8102a8a8029F0dFFC3C5f6528a298437d5D2c2e7) |
| Base Sepolia | 84532 | TBD | - |
| Arbitrum Sepolia | 421614 | TBD | - |

## Development

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Node.js 18+ (for E2E tests using viem)

### Setup

```bash
# Install dependencies
forge install

# Build contracts
forge build

# Run tests
forge test

# Run tests with verbose output
forge test -vvvv
```

### Deployment

**Testnet (V3TEST):**
```bash
cd /Users/dev/zerodust/contracts
source .env
forge script script/DeployV3.s.sol:DeployV3 --rpc-url $RPC_URL --broadcast -vvvv
```

**Mainnet:**
```bash
forge script script/DeployMainnet.s.sol:DeployMainnet --rpc-url $RPC_URL --broadcast -vvvv
```

### E2E Testing

```bash
# Set environment variables
export RELAYER_PRIVATE_KEY=0x...
export RPC_URL=https://...

# Run mainnet E2E test
node script/mainnet-e2e-test.mjs
```

## Chain-Specific Notes

### Chains Requiring Special Handling

| Chain | Issue | Solution |
|-------|-------|----------|
| **BSC** | `baseFeePerGas: 0` breaks Foundry | Use viem with explicit gas params |
| **Ronin** | Gas estimation issues with Foundry | Use viem with explicit gas params |
| **Cronos** | No standard CREATE2 factory | Different contract address |
| **XRPL EVM** | No standard CREATE2 factory | Different contract address |
| **Flow EVM** | High minimum gas price (16 gwei) | Set explicit gas price |
| **0G Galileo** | High minimum gas price (3 gwei) | Set explicit gas price |
| **Etherlink** | Gas estimation ~3x off | Use high gas limits |

### Chains NOT Supporting EIP-7702

The following chains do not support EIP-7702 and cannot use ZeroDust:

- ZKsync-based chains (Abstract, Lens, zkSync) - use native AA
- Taiko - 0xef opcode not defined
- Avalanche, opBNB, Metis - not enabled
- Many others - see CLAUDE.md for full list

## Security

### Security Features

- ERC-7201 namespaced storage (prevents slot collisions)
- Low-s signature malleability protection
- Zero balance post-condition enforcement
- Immutable sponsor addresses (in bytecode)
- Checks-Effects-Interactions pattern
- No reentrancy vulnerabilities
- No admin functions, no upgradability

### Audit Status

- Internal security review: Complete
- External audit: Pending (required before mainnet)

## Files

```
contracts/
├── src/
│   ├── ZeroDustSweepMainnet.sol    # V3 production contract
│   └── ZeroDustSweepV3TEST.sol     # V3 testnet contract
├── script/
│   ├── DeployMainnet.s.sol         # Mainnet deployment
│   ├── DeployV3.s.sol              # Testnet deployment
│   ├── mainnet-e2e-test.mjs        # E2E test (viem)
│   └── verify-eip7702.sh           # EIP-7702 chain verification
├── broadcast/                       # Deployment logs
│   ├── DeployMainnet.s.sol/        # Mainnet broadcasts
│   └── DeployV3.s.sol/             # Testnet broadcasts
├── V3_DEPLOYMENT.md                 # Deployment guide
├── V3_SPECIFICATION.md              # Technical specification
├── foundry.toml                     # Foundry config
└── .env.example                     # Environment template
```

## Related Documentation

- [V3 Deployment Guide](./V3_DEPLOYMENT.md)
- [V3 Specification](./V3_SPECIFICATION.md)
- [Backend Migration Guide](../../../zerodust-backend/docs/V2_TO_V3_MIGRATION.md)

## License

MIT
