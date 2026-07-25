#!/usr/bin/env node

/**
 * Generates the canonical supported-chains tables from the live API.
 *
 * Every chain list in this project used to be hand-maintained, and they drifted
 * apart: the README claimed 26 mainnets while the API served 25, called chain
 * 1514 "Astar zkEVM" when the API calls it Story, 5330 "Kaia" when it is
 * Superseed, and 57073 "Redstone" when it is Ink. llms.txt listed Linea, Blast
 * and Apechain, none of which are enabled. An agent that acts on a wrong chain
 * name gets an error, concludes the service is broken, and tells its user so.
 *
 * The live API is the source of truth, because it is what callers actually
 * experience. Run this and paste the output, or use --check in CI to fail when a
 * doc has drifted.
 *
 * Usage:
 *   node scripts/generate-chain-docs.mjs            # print the tables
 *   node scripts/generate-chain-docs.mjs --json     # machine-readable
 *   node scripts/generate-chain-docs.mjs --check    # verify docs match
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API = process.env.ZERODUST_API_URL ?? 'https://api.zerodust.xyz';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function fetchChains() {
  const response = await fetch(`${API}/chains`);
  if (!response.ok) {
    throw new Error(`GET ${API}/chains failed: ${response.status}`);
  }

  const { chains } = await response.json();

  return chains
    .filter((c) => c.enabled)
    .map((c) => ({
      chainId: c.chainId,
      name: c.name,
      nativeToken: c.nativeToken,
    }))
    .sort((a, b) => a.chainId - b.chainId);
}

/** Two-column markdown table, matching the README's existing layout. */
function twoColumnTable(chains) {
  const half = Math.ceil(chains.length / 2);
  const left = chains.slice(0, half);
  const right = chains.slice(half);

  const lines = [
    '| Chain | ID | Token | Chain | ID | Token |',
    '|-------|---:|-------|-------|---:|-------|',
  ];

  for (let i = 0; i < half; i += 1) {
    const l = left[i];
    const r = right[i];
    const rightCells = r ? `${r.name} | ${r.chainId} | ${r.nativeToken}` : ' | | ';
    lines.push(`| ${l.name} | ${l.chainId} | ${l.nativeToken} | ${rightCells} |`);
  }

  return lines.join('\n');
}

/** Comma-separated prose list, for llms.txt. */
function proseList(chains) {
  const names = chains.map((c) => c.name);
  const last = names.pop();
  return `${names.join(', ')}, and ${last}.`;
}

/**
 * Extracts `| Name | chainId | TOKEN |` triples from a markdown table.
 *
 * Only table rows are checked, never prose. Scanning prose for chain names
 * produced nothing but false positives: the README legitimately discusses
 * chains that do NOT support EIP-7702, and explains which names used to be
 * wrong. A row in a support table is a claim a caller will act on; a sentence
 * about Avalanche not working is not.
 */
function tableRows(text) {
  const rows = [];

  for (const line of text.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;

    const cells = line.split('|').slice(1, -1).map((c) => c.trim());

    // Rows may hold one or two chains, so walk in groups of three.
    for (let i = 0; i + 2 < cells.length; i += 3) {
      const [name, id, token] = cells.slice(i, i + 3);
      if (!/^\d+$/.test(id ?? '')) continue;
      rows.push({ name, chainId: Number(id), token });
    }
  }

  return rows;
}

/** Docs that carry a chain support table. */
const DOC_TARGETS = [
  'README.md',
  join('skills', 'zerodust', 'SKILL.md'),
  join('packages', 'mcp-server', 'README.md'),
  join('sdk', 'README.md'),
];

/**
 * Verifies every chain-table row in every doc against the live API.
 *
 * Catches three distinct failures: a row naming a chain the API does not serve,
 * a row whose name or token disagrees with the API for that chain ID, and an
 * enabled chain missing from the README table entirely.
 */
function checkDocs(chains) {
  const byId = new Map(chains.map((c) => [c.chainId, c]));
  const problems = [];

  for (const target of DOC_TARGETS) {
    let text;
    try {
      text = readFileSync(join(ROOT, target), 'utf8');
    } catch {
      continue; // not every doc exists in every checkout
    }

    for (const row of tableRows(text)) {
      const actual = byId.get(row.chainId);

      if (!actual) {
        problems.push(
          `${target}: lists chain ${row.chainId} ("${row.name}"), which the API does not serve`
        );
        continue;
      }

      if (row.name !== actual.name) {
        problems.push(
          `${target}: calls chain ${row.chainId} "${row.name}", the API calls it "${actual.name}"`
        );
      }
      if (row.token && row.token !== actual.nativeToken) {
        problems.push(
          `${target}: chain ${row.chainId} token is "${row.token}", the API says "${actual.nativeToken}"`
        );
      }
    }
  }

  // The README is the canonical list, so it should be complete.
  const readmeIds = new Set(
    tableRows(readFileSync(join(ROOT, 'README.md'), 'utf8')).map((r) => r.chainId)
  );
  for (const chain of chains) {
    if (!readmeIds.has(chain.chainId)) {
      problems.push(`README.md: missing enabled chain ${chain.chainId} (${chain.name})`);
    }
  }

  return problems;
}

const chains = await fetchChains();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ count: chains.length, chains }, null, 2));
} else if (process.argv.includes('--check')) {
  const problems = checkDocs(chains);

  if (problems.length === 0) {
    console.log(`OK: docs agree with the ${chains.length} chains the API serves.`);
  } else {
    console.error(`Chain docs have drifted from ${API}:\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('\nRun scripts/generate-chain-docs.mjs and update the tables.');
    process.exitCode = 1;
  }
} else {
  console.log(`Enabled mainnet chains: ${chains.length}\n`);
  console.log('--- README table ---\n');
  console.log(twoColumnTable(chains));
  console.log('\n--- llms.txt prose ---\n');
  console.log(proseList(chains));
}
