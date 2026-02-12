/**
 * @fileoverview Vercel AI SDK tools for ZeroDust
 *
 * Provides Vercel AI SDK-compatible tools for AI agents to interact
 * with ZeroDust - sweep native gas tokens to exactly zero.
 *
 * @example
 * ```typescript
 * import { createZeroDustTools } from '@zerodust/ai-sdk';
 *
 * const tools = createZeroDustTools({ environment: 'mainnet' });
 * // Use tools with generateText, streamText, etc.
 * ```
 *
 * @packageDocumentation
 */

export { createZeroDustTools, type ZeroDustToolsConfig } from './tools.js';
