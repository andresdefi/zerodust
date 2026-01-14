# ZeroDustSweepV3 Deployment Guide

**Last Updated:** January 12, 2026

---

## Contract Versions

| Contract | Purpose | Status |
|----------|---------|--------|
| `ZeroDustSweepV3TEST` | Testnet testing | **Active** |
| `ZeroDustSweepV3` | Mainnet production | Pending (rename before mainnet) |

---

## Testnet Deployment

### Sponsor Address (Testnet)

```
0x16c9af121C797A56902170a7f808eDF1a857ED49
```

This is the deployer address that will also serve as the sponsor for testnet deployments.

### Constructor Parameters (Testnet)

```solidity
address[] memory sponsors = new address[](1);
sponsors[0] = 0x16c9af121C797A56902170a7f808eDF1a857ED49;

new ZeroDustSweepV3TEST(
    sponsors,
    50_000,              // minOverheadGasUnits
    300_000,             // maxOverheadGasUnits
    100_000,             // maxProtocolFeeGasUnits
    5 * 10**14,          // maxExtraFeeWei (0.0005 ETH)
    10**12               // maxReimbGasPriceCapWei (1000 gwei)
);
```

### Deployment Command (Testnet)

```bash
cd /Users/dev/zerodust/contracts
source .env

# Deploy to any testnet
forge script script/DeployV3.s.sol:DeployV3 --rpc-url $RPC_URL --broadcast -vvvv
```

---

## Mainnet Deployment

### ⚠️ CRITICAL: Before Mainnet Deployment

1. **Rename contract:**
   - Change `ZeroDustSweepV3TEST` → `ZeroDustSweepV3`
   - Rename file `ZeroDustSweepV3TEST.sol` → `ZeroDustSweepV3.sol`

2. **Change sponsor addresses:**
   - **DO NOT use the testnet sponsor address on mainnet**
   - Use dedicated production sponsor EOAs with keys stored in KMS/HSM
   - Consider using 2-3 sponsors for redundancy

3. **Complete external audit:**
   - Required before mainnet deployment
   - Trail of Bits, OpenZeppelin, or Spearbit recommended

### Sponsor Addresses (Mainnet)

```
SPONSOR_1: TBD (primary hot wallet - KMS protected)
SPONSOR_2: TBD (backup hot wallet - KMS protected)
SPONSOR_3: TBD (optional - emergency backup)
```

### Constructor Parameters (Mainnet)

```solidity
address[] memory sponsors = new address[](2);  // or 3 for full redundancy
sponsors[0] = 0x...;  // SPONSOR_1 - primary
sponsors[1] = 0x...;  // SPONSOR_2 - backup

new ZeroDustSweepV3(
    sponsors,
    50_000,              // minOverheadGasUnits
    300_000,             // maxOverheadGasUnits
    100_000,             // maxProtocolFeeGasUnits
    5 * 10**14,          // maxExtraFeeWei (0.0005 ETH)
    10**12               // maxReimbGasPriceCapWei (1000 gwei)
);
```

---

## Parameter Reference

| Parameter | Value | Description |
|-----------|-------|-------------|
| `minOverheadGasUnits` | 50,000 | Minimum overhead to protect sponsor from under-recovery |
| `maxOverheadGasUnits` | 300,000 | Maximum overhead (covers complex bridges) |
| `maxProtocolFeeGasUnits` | 100,000 | ~$3 at 100 gwei (service fee) |
| `maxExtraFeeWei` | 0.0005 ETH | L2 variance buffer |
| `maxReimbGasPriceCapWei` | 1000 gwei | Cover extreme gas spikes |

---

## Sponsor Key Management

### Testnet
- Single sponsor key (deployer)
- Can be stored in `.env` file
- Acceptable security for testing

### Mainnet
- **Primary sponsor:** KMS/HSM protected (AWS KMS, GCP KMS, or Hashicorp Vault)
- **Backup sponsor:** Separate KMS key on different infrastructure
- **Treasury:** Safe multisig (2-of-3 or 3-of-5) for holding funds
- **Auto-top-up:** Daemon monitors sponsor balances, tops up from treasury when low

---

## Checklist

### Before Testnet Deployment
- [ ] Contract compiles without errors
- [ ] Sponsor address is `0x16c9af121C797A56902170a7f808eDF1a857ED49`
- [ ] Sponsor has testnet ETH for gas
- [ ] RPC URL is configured

### Before Mainnet Deployment
- [ ] Rename contract to `ZeroDustSweepV3`
- [ ] External audit completed
- [ ] Sponsor addresses are production KMS-protected EOAs
- [ ] Sponsor keys are NOT the testnet/deployer key
- [ ] Treasury Safe is set up
- [ ] Auto-top-up daemon is configured
- [ ] Monitoring and alerting is in place
- [ ] Backend is updated with mainnet contract address

---

## Contract Addresses

### Testnet Deployments

| Chain | Chain ID | Contract Address | Explorer |
|-------|----------|------------------|----------|
| Sepolia | 11155111 | TBD | - |
| Base Sepolia | 84532 | TBD | - |
| Arbitrum Sepolia | 421614 | TBD | - |

### Mainnet Deployments

| Chain | Chain ID | Contract Address | Explorer |
|-------|----------|------------------|----------|
| Ethereum | 1 | TBD | - |
| Base | 8453 | TBD | - |
| Arbitrum | 42161 | TBD | - |

---

## Notes

- The `NAME` and `VERSION` constants (`"ZeroDust"`, `"3"`) are the same for both TEST and production contracts
- EIP-712 signatures are compatible between TEST and production (same typehash)
- Nonces are per-user, stored in user's EOA storage under EIP-7702
