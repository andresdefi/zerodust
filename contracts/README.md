# ZeroDust Smart Contracts

Smart contracts for ZeroDust - an intent-based exit system for sweeping native gas tokens to exactly zero via EIP-7702.

## Overview

ZeroDust enables users to sweep their entire native token balance from any EIP-7702-compatible chain. The sponsor (relayer) executes sweeps on behalf of users, paying gas costs and receiving reimbursement from the swept funds.

**Key Features:**
- Sweep native tokens to exactly 0 balance
- Single unified `SweepIntent` structure for all sweep types
- EIP-7702 sponsored execution (user pays no gas directly)
- Same-chain transfers (MODE_TRANSFER) and cross-chain bridges (MODE_CALL)
- Transparent, granular fee structure
- ERC-7201 namespaced storage for nonce isolation

## Contracts

### ZeroDustSweepMainnet.sol (Production)

Production contract for mainnet deployments.

**Features:**
- Unified `SweepIntent` with 14 fields
- Mode-based execution (0 = transfer, 1 = call)
- Generic `callTarget + callData` pattern for bridges
- Granular fee breakdown (overhead, protocol, extra, gas cap)
- Immutable sponsor addresses
- EIP-712 signatures with user's EOA as verifyingContract

### ZeroDustSweepTEST.sol (Testnet)

Testnet contract for development and testing. Identical functionality to mainnet contract.

## Architecture

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
    uint256 extraFeeWei;           // Service fee (1%, $0.05 min, $0.50 max)
    uint256 reimbGasPriceCapWei;   // Gas price cap for reimbursement
    uint256 deadline;              // Signature expiration (unix timestamp)
    uint256 nonce;                 // Per-user nonce
}
```

### Fee Structure

**Service Fee:** 1% of swept value, with $0.05 minimum and $0.50 maximum.

```
Total Fee = Gas Reimbursement + Service Fee + Bridge Fee (if cross-chain)

Where:
- Gas Reimbursement = (overheadGasUnits) × reimbGasPriceCapWei
- Service Fee = min(max(balance × 1%, $0.05), $0.50) → goes in extraFeeWei
- Bridge Fee = Destination chain gas (cross-chain only)
```

### EIP-712 Domain

ZeroDust uses the user's EOA as the `verifyingContract` (EIP-7702 requirement):

```solidity
{
    name: "ZeroDust",
    version: "3",
    chainId: <chain_id>,
    verifyingContract: <user_address>  // User's EOA, not contract
}
```

## Deployments

### Mainnet Deployments

**Contract Address (same on all chains):** `0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2`

Deployed via CREATE2 for deterministic addresses across all chains.

| Chain | Chain ID | Native Token | Explorer |
|-------|----------|--------------|----------|
| Ethereum | 1 | ETH | [View](https://etherscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Optimism | 10 | ETH | [View](https://optimistic.etherscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| BSC | 56 | BNB | [View](https://bscscan.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Gnosis | 100 | xDAI | [View](https://gnosisscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Unichain | 130 | ETH | [View](https://unichain.blockscout.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Polygon | 137 | POL | [View](https://polygonscan.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Sonic | 146 | S | [View](https://sonicscan.org/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| X Layer | 196 | OKB | [View](https://www.oklink.com/xlayer/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Fraxtal | 252 | frxETH | [View](https://fraxscan.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| World Chain | 480 | ETH | [View](https://worldscan.org/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Sei | 1329 | SEI | [View](https://seitrace.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Astar zkEVM | 1514 | ETH | [View](https://astar-zkevm.explorer.startale.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Soneium | 1868 | ETH | [View](https://soneium.blockscout.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Mantle | 5000 | MNT | [View](https://mantlescan.xyz/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Kaia | 5330 | KAIA | [View](https://kaiascan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Base | 8453 | ETH | [View](https://basescan.org/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Plasma | 9745 | XPL | [View](https://explorer.plasma.to/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| ApeChain | 33139 | APE | [View](https://apescan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Mode | 34443 | ETH | [View](https://explorer.mode.network/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Arbitrum | 42161 | ETH | [View](https://arbiscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Celo | 42220 | CELO | [View](https://celoscan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Redstone | 57073 | ETH | [View](https://explorer.redstone.xyz/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| BOB | 60808 | ETH | [View](https://explorer.gobob.xyz/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Berachain | 80094 | BERA | [View](https://berascan.io/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Scroll | 534352 | ETH | [View](https://scrollscan.com/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |
| Zora | 7777777 | ETH | [View](https://explorer.zora.energy/address/0x3732398281d0606aCB7EC1D490dFB0591BE4c4f2) |

**Total: 26 mainnet chains**

### Testnet Deployments

**Contract Address:** `0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC` (most chains)

| Chain | Chain ID | Contract Address | Explorer |
|-------|----------|------------------|----------|
| Sepolia | 11155111 | `0x8102a8a8029F0dFFC3C5f6528a298437d5D2c2e7` | [View](https://sepolia.etherscan.io/address/0x8102a8a8029F0dFFC3C5f6528a298437d5D2c2e7) |
| Base Sepolia | 84532 | `0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC` | [View](https://sepolia.basescan.org/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Arbitrum Sepolia | 421614 | `0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC` | [View](https://sepolia.arbiscan.io/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |

See `broadcast/` directory for full testnet deployment records (46 chains).

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
│   ├── ZeroDustSweepMainnet.sol    # Production contract
│   └── ZeroDustSweepTEST.sol       # Testnet contract
├── script/
│   ├── DeployMainnet.s.sol         # Mainnet deployment (CREATE2)
│   ├── mainnet-e2e-test.mjs        # E2E test (viem)
│   └── verify-eip7702.sh           # EIP-7702 chain verification
├── broadcast/
│   └── DeployMainnet.s.sol/        # Deployment logs by chain
├── DEPLOYMENT.md                    # Deployment guide
├── SPECIFICATION.md                 # Technical specification
├── foundry.toml                     # Foundry config
└── .env.example                     # Environment template
```

## Related Documentation

- [Deployment Guide](./DEPLOYMENT.md)
- [Specification](./SPECIFICATION.md)

## License

MIT
