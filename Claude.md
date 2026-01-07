# Claude.md - AI Development Guidelines for ZeroDust

## Repository Structure

**This repository (`zerodust`) contains:**
- Smart contracts (`/contracts`)
- SDK (when built, `/sdk`)
- Documentation

**Related repositories:**
- [zerodust-backend](https://github.com/zerodustxyz/zerodust-backend) (private) - Backend/relayer service

## System Understanding

### What ZeroDust Is

ZeroDust is a specialized infrastructure service that solves a specific, previously unsolvable problem: **sweeping native gas tokens to exactly zero** when exiting a blockchain. This is achieved through EIP-7702 sponsored execution, where users sign an authorization and ZeroDust's relayer executes the sweep on their behalf.

### Core Architecture Mental Model

```
USER PERSPECTIVE:
"I have 0.0008 ETH on Arbitrum. I want 0 ETH on Arbitrum and ~0.0007 ETH on Base."
    │
    └── Sign one message → Done. Balance is exactly zero.

SYSTEM PERSPECTIVE:
User signs EIP-7702 authorization
    │
    └── Relayer validates → simulates → executes → user receives funds
        │
        └── Contract atomically: sweeps user → pays relayer → sends remainder
```

### Critical Invariants

These properties must NEVER be violated:

1. **User funds are never custodied** - All operations are atomic, single-transaction
2. **User cannot pay more than maxRelayerCompensation** - This is signed and enforced
3. **Sweep always results in zero balance** - The entire native balance is swept
4. **Nonces are never reused** - Each authorization executes exactly once
5. **Deadlines are enforced** - Expired authorizations are rejected
6. **Simulation precedes execution** - No transaction submitted without successful simulation

### What Makes This System Unique

1. **EIP-7702 dependency** - This only works on chains supporting EIP-7702
2. **Sponsored execution** - User pays no gas; relayer pays and is reimbursed
3. **Native token focus** - Only handles native gas tokens (ETH, MATIC, BNB), not ERC-20s
4. **Sweep-all design** - No partial sweeps; always sweeps entire balance

---

## ⚠️ CRITICAL: Project Status & Chain-Specific Notes

### Milestone Status (Updated: January 2026)

| Milestone | Status | Notes |
|-----------|--------|-------|
| **M1: Smart Contract** | ✅ COMPLETE | Deployed & E2E verified on 16 testnets |
| M2: Backend/Relayer | 🔜 Next | Ready to start |
| M3: SDK | ⏳ Pending | Depends on M2 |
| M4: Frontend | ⏳ Pending | Depends on M3 |
| M5: Testing & QA | ⏳ Pending | |
| M6: Audit & Launch | ⏳ Pending | |

### 📋 PENDING WORK (Continue from here)

**Last Updated: January 6, 2026**

#### Chains Pending Deployment & E2E Testing:

| Chain | Chain ID | Faucet/Bridge | Status |
|-------|----------|---------------|--------|
| Plasma Testnet | 9746 | https://faucet.plasma.to/ | ⏳ Needs faucet funds |

**Deployer Address:** `0x16c9af121C797A56902170a7f808eDF1a857ED49`

**Deployment Command (once funded):**
```bash
cd /Users/dev/zerodust/contracts
source .env
forge script script/Deploy.s.sol:Deploy --rpc-url "<RPC_URL>" --broadcast -vvvv
```

#### Backend (M2) Status:
- ✅ Backend moved to private repo: [zerodust-backend](https://github.com/zerodustxyz/zerodust-backend)
- ✅ Basic structure with 19 chains configured
- ✅ Supabase schema ready
- ⏳ Backend not fully tested
- ⏳ Relayer worker not implemented yet

### Contract Deployment (Deterministic Address via CREATE2)

**Address: `0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC`** (same on all chains)

| Chain | Chain ID | E2E Verified | Explorer |
|-------|----------|--------------|----------|
| Sepolia | 11155111 | ✅ | [View](https://sepolia.etherscan.io/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Base Sepolia | 84532 | ✅ | [View](https://sepolia.basescan.org/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Arbitrum Sepolia | 421614 | ✅ | [View](https://sepolia.arbiscan.io/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Optimism Sepolia | 11155420 | ✅ | [View](https://sepolia-optimism.etherscan.io/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| BSC Testnet | 97 | ✅ | [View](https://testnet.bscscan.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Polygon Amoy | 80002 | ✅ | [View](https://amoy.polygonscan.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Gnosis Chiado | 10200 | ✅ | [View](https://gnosis-chiado.blockscout.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Unichain Sepolia | 1301 | ✅ | [View](https://sepolia.uniscan.xyz/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Berachain Bepolia | 80069 | ✅ | [View](https://bepolia.beratrail.io/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Plasma Testnet | 9746 | ⏳ Pending | [View](https://testnet-explorer.plasma.to/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Mantle Sepolia | 5003 | ✅ | [View](https://sepolia.mantlescan.xyz/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Ink Sepolia | 763373 | ✅ | [View](https://explorer-sepolia.inkonchain.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Mode Sepolia | 919 | ✅ | [View](https://sepolia.explorer.mode.network/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Zora Sepolia | 999999999 | ✅ | [View](https://sepolia.explorer.zora.energy/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Soneium Minato | 1946 | ✅ | [View](https://explorer-testnet.soneium.org/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Metal L2 Testnet | 1740 | ✅ | [View](https://testnet.explorer.metall2.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| Lisk Sepolia | 4202 | ✅ | [View](https://sepolia-blockscout.lisk.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |
| World Chain Sepolia | 4801 | ✅ | [View](https://worldchain-sepolia.explorer.alchemy.com/address/0x05a94F2479eE0Fa99f1790e1cB0A8d326263f6eC) |

### 🚨 BSC Chain-Specific Requirements

**BSC (BNB Chain) requires different tooling for EIP-7702 transactions:**

**Problem:** Foundry's `cast` and `forge script --broadcast` cannot properly construct EIP-7702 (type 4) transactions on BSC because BSC has `baseFeePerGas: 0`, which causes cast to fail with:
```
Error: local usage error: missing properties: [("Wallet", ["max_fee_per_gas", "max_priority_fee_per_gas"])]
```

**Solution:** Use `viem` (JavaScript/TypeScript) instead of Foundry tools for BSC EIP-7702 transactions.

**Implementation:**
- For testing: Use `contracts/script/bsc-e2e-test.mjs` (viem-based)
- For backend relayer (M2): Must use `viem` or `ethers.js` for BSC chain, NOT Foundry

**Code example (viem):**
```typescript
import { createWalletClient } from 'viem';

// Sign EIP-7702 authorization
const authorization = await walletClient.signAuthorization({
    account: userAccount,
    contractAddress: SWEEP_CONTRACT,
});

// Send with explicit gas params (required for BSC)
const tx = await walletClient.sendTransaction({
    to: userAccount.address,
    data: calldata,
    authorizationList: [authorization],
    gas: 200000n,
    maxFeePerGas: 3000000000n,      // 3 gwei
    maxPriorityFeePerGas: 3000000000n // 3 gwei
});
```

**Files:**
- `contracts/script/bsc-e2e-test.mjs` - Working BSC E2E test with viem
- `contracts/script/e2e-test.sh` - Works for all chains EXCEPT BSC
- `contracts/script/e2e-all-chains.sh` - Multi-chain runner (BSC will show TX_FAILED)

### 🚨 Chain-Specific Notes for Mainnet

**CRITICAL: Review these before mainnet deployment**

| Chain | Special Consideration | Action Required |
|-------|----------------------|-----------------|
| **BSC** | `baseFeePerGas: 0` breaks Foundry | Use viem with explicit gas params |
| **Monad** | 10 MON balance floor for EIP-7702 delegated EOAs | **DO NOT SUPPORT** - breaks "sweep to zero" promise |
| **Superchain (OP Stack)** | Isthmus hardfork enabled EIP-7702 | Standard implementation works |
| **Berachain** | Standard EIP-7702 | No special handling needed |
| **Mantle** | Standard EIP-7702 | No special handling needed |
| **Lisk** | Foundry test addresses have pre-deployed smart wallets | Use random addresses for testing, see below |

### 🚨 Lisk Sepolia-Specific Notes

**Discovered during E2E testing on January 6, 2026:**

#### Issue 1: Foundry Hardhat Addresses Have Pre-Deployed Smart Wallets

On Lisk Sepolia, common test addresses (like `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`) have EIP-7702 delegation code pre-deployed pointing to a passkey/smart wallet contract:

```
Code: 0xef01006bd9b71559e3b2013596726a4e2ca1ee97189606
Delegation target: 0x6bd9b71559e3b2013596726a4e2ca1ee97189606
```

**Impact:** ETH sent to these addresses is handled by the smart wallet contract, not credited as normal balance.

**Solution:** Use randomly generated addresses for E2E testing on Lisk:
```bash
RANDOM_PK="0x$(openssl rand -hex 32)"
RANDOM_ADDR=$(cast wallet address --private-key $RANDOM_PK)
```

#### Issue 2: EIP-7702 Nonce Storage Location

With EIP-7702, when the contract code runs on the USER's address:
- State changes (like `usedNonces[user][nonce] = true`) are written to the USER's storage, not the contract's storage
- VIEW functions (`isNonceUsed`, `getNextNonce`) read from the CONTRACT's storage, showing stale/zero data

**Impact:**
- `isNonceUsed(user, 0)` returns `false` even after nonce 0 is used
- `getNextNonce(user)` always returns `0`

**But security is maintained:** When `executeSweep` runs via EIP-7702 on the user's address, it correctly reads from the user's storage and will revert with `NonceAlreadyUsed` if the nonce was already used.

**Backend/Frontend Implication:**
- Do NOT rely on `getNextNonce()` for nonce tracking
- Track nonces in the database per-user per-chain (already planned)
- The contract's VIEW functions are decorative, not reliable for EIP-7702 users

### ⚠️ Relayer Implementation Notes

1. **Transaction Timing**: Always wait for funding confirmation before executing sweep
   - Race condition discovered: If sweep executes before funding confirms, it sweeps 0 and user keeps funds
   - Solution: Verify non-zero balance before creating authorization

2. **Gas Price Handling**: Some chains have unusual gas pricing
   - BSC: `baseFeePerGas: 0` requires explicit `maxFeePerGas` and `maxPriorityFeePerGas`
   - L2s: Generally very low gas, but verify before mainnet

3. **RPC Reliability**: Use multiple RPC providers per chain for redundancy
   - Public RPCs may rate limit or have downtime
   - Critical for mainnet: dedicated RPC endpoints

4. **Domain Separator**: Each chain has unique DOMAIN_SEPARATOR (includes chainId)
   - Signatures are chain-specific and cannot be replayed cross-chain

### E2E Test Scripts

| Script | Purpose | Chains |
|--------|---------|--------|
| `script/e2e-test.sh` | Single chain E2E test (cast) | All except BSC |
| `script/e2e-all-chains.sh` | Multi-chain test runner | All except BSC |
| `script/bsc-e2e-test.mjs` | BSC E2E test (viem) | BSC only |

### Test Results Summary

All verified testnets (14 total, 10 E2E tested) have confirmed sweep transactions where user balance goes to exactly **0**:
- Contract correctly verifies EIP-712 signatures
- EIP-7702 delegation works on all chains
- Relayer compensation is correctly deducted
- Remainder is sent to destination

---

## Development Philosophy

### Security-First Mindset

Every line of code I write must consider:

1. **What can go wrong?** - Enumerate failure modes before writing
2. **Who might attack this?** - Consider malicious users, MEV bots, compromised keys
3. **What's the worst case?** - Quantify maximum possible loss
4. **How do we detect failure?** - Build in monitoring and alerts

### Code Quality Standards

**For Smart Contracts:**
- Every function has NatSpec documentation
- Every state change emits an event
- Every external call follows checks-effects-interactions
- Every revert has a descriptive error message
- No magic numbers - use named constants
- No unnecessary complexity - simpler is safer

**For Backend:**
- Every endpoint has input validation
- Every database query uses parameterized statements
- Every error is logged with context
- Every external call has timeout and retry logic
- No secrets in code - use environment variables
- No blocking operations in request handlers

**For Frontend:**
- Every user action has loading and error states
- Every form has validation before submission
- Every external data is sanitized before display
- Every sensitive operation requires confirmation
- No user-unfriendly error messages
- No stuck states - always provide escape paths

**For SDK:**
- Every public function has TypeScript types
- Every function has JSDoc documentation
- Every error is typed and descriptive
- Every async operation is cancellable
- No breaking changes without major version bump
- No dependencies that bloat bundle size

---

## Component-Specific Guidelines

### Smart Contract Development

**I will:**
- Use Foundry for all contract development
- Write comprehensive tests before implementation
- Use fuzzing to find edge cases
- Keep contracts minimal - every line is attack surface
- Follow established patterns (OpenZeppelin where appropriate)
- Document all assumptions explicitly

**I will NOT:**
- Add admin functions unless absolutely necessary
- Use proxy patterns (contract is immutable)
- Store unnecessary data on-chain
- Make external calls without reentrancy protection
- Assume gas prices or block times

**Testing Requirements:**
```solidity
// Every public function needs:
// 1. Happy path test
// 2. Revert condition tests (all require/revert statements)
// 3. Edge case tests (zero values, max values)
// 4. Fuzz tests for numeric inputs

function test_executeSweep_success() public { ... }
function test_executeSweep_reverts_invalidSignature() public { ... }
function test_executeSweep_reverts_expiredDeadline() public { ... }
function test_executeSweep_reverts_usedNonce() public { ... }
function test_executeSweep_reverts_insufficientBalance() public { ... }
function testFuzz_executeSweep_compensation(uint256 compensation) public { ... }
```

### Backend/Relayer Development

**I will:**
- Validate all inputs at API boundary
- Log all significant operations
- Implement circuit breakers for external dependencies
- Use queues for async operations
- Handle all error cases explicitly
- Monitor and alert on anomalies

**I will NOT:**
- Trust any user input
- Execute transactions without simulation
- Store private keys in code or database
- Make blocking calls in request handlers
- Ignore rate limiting requirements
- Expose internal errors to users

**Relayer Safety Policy Implementation:**
```typescript
// EVERY sweep execution MUST pass ALL checks
async function executeSweep(sweep: SweepRequest): Promise<SweepResult> {
  // 1. Signature verification
  if (!verifySignature(sweep.authorization, sweep.signature)) {
    return reject('INVALID_SIGNATURE');
  }

  // 2. Deadline check
  if (Date.now() > sweep.authorization.deadline * 1000) {
    return reject('EXPIRED');
  }

  // 3. Nonce check
  if (await isNonceUsed(sweep.authorization.user, sweep.authorization.nonce)) {
    return reject('NONCE_USED');
  }

  // 4. Balance check
  const balance = await getBalance(sweep.authorization.user);
  if (balance < MINIMUM_BALANCE[chainId]) {
    return reject('BALANCE_TOO_LOW');
  }

  // 5. Gas price check
  const gasPrice = await getGasPrice();
  if (gasPrice > sweep.authorization.maxFeePerGas) {
    return reject('GAS_PRICE_EXCEEDED');
  }

  // 6. Simulation - MANDATORY
  const simulation = await simulate(sweep);
  if (!simulation.success) {
    return reject('SIMULATION_FAILED', simulation.error);
  }

  // 7. Only now execute
  return await submitTransaction(sweep);
}
```

### SDK Development

**I will:**
- Provide full TypeScript types
- Document all public APIs
- Handle all error cases gracefully
- Support both ESM and CJS
- Keep bundle size minimal
- Make integration trivial

**I will NOT:**
- Break backwards compatibility without major version
- Add unnecessary dependencies
- Expose implementation details
- Make assumptions about wallet implementations
- Require specific framework versions

**SDK Error Handling:**
```typescript
// All errors are typed and actionable
class ZeroDustError extends Error {
  constructor(
    public code: ZeroDustErrorCode,
    public message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
  }
}

// Error codes are exhaustive
enum ZeroDustErrorCode {
  // User errors
  BALANCE_TOO_LOW = 'BALANCE_TOO_LOW',
  QUOTE_EXPIRED = 'QUOTE_EXPIRED',
  SIGNATURE_REJECTED = 'SIGNATURE_REJECTED',

  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  RPC_ERROR = 'RPC_ERROR',

  // System errors
  CHAIN_PAUSED = 'CHAIN_PAUSED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}
```

### Frontend Development

**I will:**
- Prioritize user experience
- Handle all loading and error states
- Provide clear, actionable feedback
- Make the UI responsive on all devices
- Follow accessibility guidelines
- Match the design aesthetic of modern DEXs

**I will NOT:**
- Show technical error messages to users
- Leave users in stuck states
- Make assumptions about wallet state
- Skip confirmation for important actions
- Ignore mobile users

**Error Message Translation:**
```typescript
// Internal error → User-friendly message
const ERROR_MESSAGES: Record<string, string> = {
  'BALANCE_TOO_LOW': 'Your balance is too low to sweep. Minimum required: {min}',
  'QUOTE_EXPIRED': 'Quote expired. Getting a fresh quote...',
  'GAS_PRICE_EXCEEDED': 'Network is busy. Please try again in a moment.',
  'SIMULATION_FAILED': 'Transaction would fail. Please try again.',
  'SIGNATURE_REJECTED': 'Signature cancelled.',
  'NETWORK_ERROR': 'Network error. Please check your connection.',
  'CHAIN_PAUSED': 'This chain is temporarily unavailable. Please try another.',
};
```

---

## Security Considerations

### Threat Model

| Threat Actor | Motivation | Attack Vectors |
|--------------|------------|----------------|
| Malicious User | Grief relayer, steal funds | Fake signatures, balance manipulation |
| MEV Bot | Extract value | Front-running, sandwich attacks |
| Compromised Key | Steal treasury | Sign malicious transactions |
| Network Attacker | Disrupt service | DDoS, man-in-the-middle |
| Smart Contract Bug | N/A | Reentrancy, overflow, logic errors |

### Mitigations I Will Implement

**Against Malicious Users:**
- Mandatory simulation before execution
- Nonce tracking prevents replay
- Deadline enforcement prevents stale authorizations
- Rate limiting prevents spam

**Against MEV:**
- Private transaction submission (Flashbots where available)
- Short deadlines reduce window
- Compensation caps limit extraction

**Against Key Compromise:**
- KMS for hot wallet (no plaintext keys)
- Minimal hot wallet balance
- Multisig for treasury
- Alert on unusual activity

**Against Network Attacks:**
- Rate limiting
- Request validation
- Multiple RPC providers
- Circuit breakers

**Against Contract Bugs:**
- Comprehensive testing
- Fuzzing
- External audit
- Minimal contract surface

### Security Review Checklist

Before any code is merged, I will verify:

**Smart Contract:**
- [ ] No reentrancy vulnerabilities
- [ ] All external calls follow CEI pattern
- [ ] Integer operations can't overflow (Solidity 0.8+)
- [ ] Access control is correct
- [ ] Events emitted for all state changes
- [ ] All revert reasons are descriptive
- [ ] No unused code or variables

**Backend:**
- [ ] All inputs validated and sanitized
- [ ] All database queries parameterized
- [ ] No secrets in code or logs
- [ ] Rate limiting enforced
- [ ] Error responses don't leak internals
- [ ] Authentication/authorization correct
- [ ] Timeouts on all external calls

**Frontend:**
- [ ] No XSS vulnerabilities
- [ ] No sensitive data in localStorage
- [ ] HTTPS only
- [ ] CSP headers configured
- [ ] No API keys in client code

---

## Quality Assurance

### Testing Strategy

```
Testing Pyramid:

                    ┌─────────────┐
                    │     E2E     │  ← Few, critical paths
                    │   Tests     │
                    ├─────────────┤
                    │ Integration │  ← Component interactions
                    │   Tests     │
                    ├─────────────┤
                    │             │
                    │    Unit     │  ← Many, fast, isolated
                    │   Tests     │
                    │             │
                    └─────────────┘
```

### Coverage Requirements

| Component | Line Coverage | Branch Coverage |
|-----------|---------------|-----------------|
| Contracts | > 95% | > 90% |
| Backend | > 85% | > 80% |
| SDK | > 90% | > 85% |
| Frontend | > 70% | > 60% |

### Code Review Standards

Every change must:
1. Have passing CI (tests, lint, type-check)
2. Include tests for new functionality
3. Update documentation if behavior changes
4. Follow established patterns
5. Have no security warnings from scanners

---

## Communication & Documentation

### Code Documentation

**Every file should have:**
```typescript
/**
 * @fileoverview Brief description of what this file does
 *
 * This module handles [specific responsibility].
 * It is used by [consumers] and depends on [dependencies].
 */
```

**Every public function should have:**
```typescript
/**
 * Brief description of what the function does.
 *
 * @param param1 - Description of first parameter
 * @param param2 - Description of second parameter
 * @returns Description of return value
 * @throws {ErrorType} When this error condition occurs
 *
 * @example
 * const result = await functionName(arg1, arg2);
 */
```

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>

Types: feat, fix, docs, style, refactor, test, chore
Scope: contract, backend, sdk, frontend, infra
```

Examples:
```
feat(contract): implement executeSweep function

Adds the core sweep functionality with signature verification,
nonce tracking, and compensation handling.

Closes #123

---

fix(backend): prevent race condition in nonce assignment

Multiple concurrent quote requests could receive the same nonce.
Now using database-level locking to ensure uniqueness.

Fixes #456
```

---

## My Contribution Approach

### How I Will Work

1. **Understand before implementing** - Read existing code, understand context
2. **Plan before coding** - Consider edge cases, failure modes
3. **Test as I build** - Write tests alongside implementation
4. **Document as I go** - Don't defer documentation
5. **Review my own work** - Self-review before requesting review
6. **Iterate on feedback** - Incorporate review comments fully

### What I Will Deliver

For each milestone:
1. **Working code** - Functional, tested, documented
2. **Tests** - Unit, integration, and E2E as appropriate
3. **Documentation** - Code comments, API docs, usage guides
4. **Security review** - Checklist completed for my changes

### What I Need From You

1. **Clear requirements** - What problem are we solving?
2. **Timely feedback** - Quick review cycles
3. **Context on decisions** - Why certain choices were made
4. **Access to resources** - APIs, services, credentials needed
5. **Clarification when unclear** - Rather than assume

---

## Red Lines - Things I Will Never Do

### Security Red Lines

1. **Never store or log private keys**
2. **Never skip simulation before transaction**
3. **Never execute without all preflight checks**
4. **Never expose internal errors to users**
5. **Never commit secrets to repository**

### Quality Red Lines

1. **Never merge without passing tests**
2. **Never skip input validation**
3. **Never leave users in stuck states**
4. **Never break backwards compatibility silently**
5. **Never ignore security warnings**

### Process Red Lines

1. **Never deploy without review**
2. **Never skip the deployment checklist**
3. **Never ignore monitoring alerts**
4. **Never make production changes without logging**
5. **Never assume - always verify**

---

## Incident Response

### If Something Goes Wrong

1. **Detect** - Monitoring alerts, user reports
2. **Assess** - Scope of impact, root cause hypothesis
3. **Mitigate** - Pause affected systems if needed
4. **Communicate** - Inform users of status
5. **Fix** - Implement solution
6. **Verify** - Confirm fix works
7. **Post-mortem** - Document and prevent recurrence

### Circuit Breaker Triggers

| Condition | Action |
|-----------|--------|
| Contract exploit suspected | Pause all chains immediately |
| Success rate < 90% | Pause affected chain |
| Treasury balance critical | Pause all chains |
| RPC provider down | Switch to backup |
| Anomalous transaction patterns | Alert + investigate |

---

## Supported Chains at Launch

All EIP-7702 compatible chains will be supported from launch:

| Chain | Chain ID | Native Token | Notes |
|-------|----------|--------------|-------|
| Ethereum | 1 | ETH | Reference implementation |
| BSC | 56 | BNB | High volume |
| Base | 8453 | ETH | High volume |
| Optimism | 10 | ETH | Audit grant available |
| Arbitrum | 42161 | ETH | Audit grant available |
| Unichain | 130 | ETH | New chain |
| Polygon | 137 | POL | High user count |
| Gnosis | 100 | xDAI | Established chain |

All chains require:
1. Bungee support for cross-chain sweeps
2. Reliable RPC providers
3. Block explorer for verification
4. Treasury funding

---

## Success Definition

### Technical Success

- Sweep success rate > 99%
- Same-chain sweep latency < 30 seconds
- Cross-chain sweep latency < 5 minutes
- Zero security incidents
- Zero lost user funds

### User Success

- Clear, intuitive interface
- Transparent fee breakdown
- Real-time status updates
- Helpful error messages
- Works on mobile

### Business Success

- Growing sweep volume
- Positive user feedback
- Wallet partner interest
- Sustainable unit economics

---

*This document defines how I will approach building ZeroDust. It is my commitment to quality, security, and user experience.*

*Document Version: 1.0*
*Created: January 2026*
