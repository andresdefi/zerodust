# SDK Development Status

Last Updated: February 1, 2026

## Current Status: Ready for Beta Release

The SDK is feature-complete and ready for initial npm publish.

---

## What's Complete

### Core SDK
- [x] `ZeroDust` client class with all API methods
- [x] Full TypeScript types matching backend API
- [x] Error handling with typed error classes
- [x] Input validation utilities
- [x] EIP-712 signature helpers
- [x] Retry logic with exponential backoff
- [x] Chain response caching

### Testing
- [x] Unit tests (118 tests, 100% passing)
- [x] Integration test structure (runs against testnet API)
- [x] Test scripts: `npm test`, `npm run test:integration`

### Documentation
- [x] README.md with full API reference
- [x] CHANGELOG.md for version tracking
- [x] Inline JSDoc documentation
- [x] Examples folder with working code samples

### Build & CI/CD
- [x] ESM + CJS dual package build
- [x] TypeScript declaration files
- [x] GitHub Actions CI (tests on Node 18/20/22)
- [x] GitHub Actions publish workflow

---

## What's Still Missing (Optional Enhancements)

### Before First Publish
- [ ] **Test against live testnet API** - Integration tests need backend running
- [ ] **Create NPM_TOKEN secret** - Required for automated publishing

### Nice to Have (Post-Launch)
- [ ] **Browser bundle** - UMD/IIFE for CDN usage (currently ESM/CJS only)
- [ ] **TypeDoc generated docs** - Hosted API documentation
- [ ] **More examples** - React hooks, ethers.js integration
- [ ] **Retry configuration** - Expose retry options to users
- [ ] **WebSocket support** - Real-time sweep status updates
- [ ] **Batch operations** - Sweep multiple chains in one call

---

## How to Publish to npm

### First Time Setup

1. **Create npm account** (if needed):
   ```bash
   npm login
   ```

2. **Add NPM_TOKEN to GitHub**:
   - Go to GitHub repo → Settings → Secrets → Actions
   - Add secret named `NPM_TOKEN` with your npm token
   - Get token from: https://www.npmjs.com/settings/~/tokens

3. **Verify package.json**:
   - Check `name` is correct: `@zerodust/sdk`
   - Check `version` is correct: `0.1.0`
   - Check `repository.url` points to correct repo

### Publishing

**Option A: Automated (Recommended)**
1. Create a GitHub Release with tag `v0.1.0`
2. The `publish.yml` workflow will automatically:
   - Run tests
   - Build the package
   - Publish to npm with provenance

**Option B: Manual**
```bash
cd sdk
npm run build
npm test
npm publish --access public
```

### Version Bumping

For subsequent releases:
```bash
# Patch release (0.1.0 → 0.1.1)
npm version patch

# Minor release (0.1.0 → 0.2.0)
npm version minor

# Major release (0.1.0 → 1.0.0)
npm version major
```

Then create a GitHub Release with the new version tag.

---

## Project Roadmap Context

### Milestones Status

| Milestone | Status | Notes |
|-----------|--------|-------|
| M1: Smart Contract | ✅ Complete | V3 on 26 mainnets |
| M2: Backend/Relayer | ✅ Complete | All features working |
| M3: Frontend | ✅ Complete | Tested with Rabby |
| M4: Mainnet Deployment | ✅ Complete | 26 chains, 650 routes |
| **M5: SDK** | ✅ Complete | Ready for publish |
| M6: Testing & QA | ✅ Complete | 599 stress tests, 99% success |
| **M7: Audit & Launch** | ⏳ Next | Security audit needed |

### What's Already Been Done (M6 Progress)

These were completed in earlier sessions:

- [x] **Backend E2E tested** - Extensively tested against testnet
- [x] **26 mainnet chains verified** - 4 mainnet sweeps with auto-revoke (Base, Arbitrum, Polygon, BSC)
- [x] **Stress testing done** - 599 sweeps across 6 chains, ~99% success rate
- [x] **Cross-chain verified** - Arbitrum → Base (93.93% user receives)
- [x] **Frontend tested** - Working with forked Rabby wallet

### What's Actually Next

1. **Publish SDK to npm** (see publishing instructions below)

2. **M7: Audit & Launch**
   - Formal security audit of smart contracts
   - Final security review of backend
   - Production launch checklist

3. **Optional: Frontend SDK Migration**
   - Current frontend uses direct API calls
   - Could refactor to use SDK for consistency
   - Not a blocker for launch

---

## File Structure Reference

```
sdk/
├── .github/
│   └── workflows/
│       ├── ci.yml              # Test on PR/push
│       └── publish.yml         # Publish on release
├── dist/                       # Built output (gitignored)
├── examples/
│   ├── README.md
│   ├── basic-sweep.ts
│   ├── check-balances.ts
│   └── cross-chain-sweep.ts
├── src/
│   ├── client.ts               # Main ZeroDust class
│   ├── errors.ts               # Error classes
│   ├── index.ts                # Public exports
│   ├── types.ts                # TypeScript interfaces
│   └── utils/
│       ├── signature.ts        # EIP-712 helpers
│       └── validation.ts       # Input validation
├── tests/
│   ├── client.test.ts
│   ├── errors.test.ts
│   ├── signature.test.ts
│   ├── validation.test.ts
│   └── integration/
│       ├── balances.integration.test.ts
│       ├── chains.integration.test.ts
│       └── quote.integration.test.ts
├── CHANGELOG.md
├── DEVELOPMENT.md              # This file
├── README.md
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

---

## Quick Commands

```bash
# Development
npm install          # Install dependencies
npm run dev          # Watch mode build
npm run typecheck    # Type check without build

# Testing
npm test             # Unit tests only
npm run test:watch   # Watch mode
npm run test:integration  # Integration tests
npm run test:all     # All tests
npm run test:coverage    # With coverage

# Build
npm run build        # Production build
npm run clean        # Clean dist/

# Examples
npx tsx examples/check-balances.ts 0xYourAddress
PRIVATE_KEY=0x... npx tsx examples/basic-sweep.ts
```

---

## Contact & Resources

- **SDK Package**: `@zerodust/sdk` on npm
- **Repository**: https://github.com/andresdefi/zerodust
- **Website**: https://zerodust.xyz
- **Backend Repo**: https://github.com/andresdefi/zerodust-backend (private)
