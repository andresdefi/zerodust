/**
 * @fileoverview Every chain the API serves has a default RPC, so an agent
 * sweeps on all of them without configuration
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_RPC_URLS } from '../src/utils/default-rpcs.js';

// GET https://api.zerodust.xyz/chains, 2026-10-01 (45 chains). Add a chain
// here when the API enables one; the test then asks for its RPC.
const API_CHAINS = [
  1, 10, 56, 100, 130, 137, 146, 169, 196, 252, 360, 480, 988, 1135, 1329, 1514, 1672, 1868, 2020, 2818,
  4326, 4663, 5000, 5031, 5042, 5330, 8453, 9745, 33139, 34443, 42018, 42161, 42220, 43111, 48900, 57073,
  59144, 60808, 80094, 97477, 98866, 167000, 534352, 685689, 747474, 7777777,
];

describe('DEFAULT_RPC_URLS', () => {
  it('has an https RPC for every chain the API serves', () => {
    expect(API_CHAINS).toHaveLength(46);
    for (const chainId of API_CHAINS) {
      expect(DEFAULT_RPC_URLS[chainId], `chain ${chainId}`).toMatch(/^https:\/\//);
    }
  });

  it('carries no keyed URL', () => {
    for (const url of Object.values(DEFAULT_RPC_URLS)) expect(url).not.toMatch(/api[-_]?key|\/v2\/[A-Za-z0-9_-]{20,}/i);
  });
});
