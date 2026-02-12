/**
 * @fileoverview LangChain tools for ZeroDust
 *
 * Provides LangChain-compatible tools for AI agents to interact
 * with ZeroDust - sweep native gas tokens to exactly zero.
 *
 * @example
 * ```typescript
 * import { createZeroDustTools } from '@zerodust/langchain';
 *
 * const tools = createZeroDustTools({ environment: 'mainnet' });
 * // Use tools with any LangChain agent
 * ```
 *
 * @packageDocumentation
 */

export { createZeroDustTools, type ZeroDustToolsConfig } from './tools.js';
