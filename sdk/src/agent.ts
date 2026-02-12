/**
 * @fileoverview ZeroDust Agent SDK
 *
 * High-level abstraction for AI agents and automated systems that control
 * their own private keys. This module handles all signing automatically,
 * allowing agents to sweep chains with a single method call.
 *
 * @example
 * ```typescript
 * import { ZeroDustAgent } from '@zerodust/sdk';
 * import { privateKeyToAccount } from 'viem/accounts';
 *
 * const agent = new ZeroDustAgent({
 *   account: privateKeyToAccount('0x...'),
 *   environment: 'mainnet',
 * });
 *
 * // Sweep a single chain
 * const result = await agent.sweep({
 *   fromChainId: 42161,  // Arbitrum
 *   toChainId: 8453,     // Base
 *   destination: '0x...',
 * });
 *
 * // Sweep multiple chains at once
 * const results = await agent.batchSweep({
 *   sweeps: [
 *     { fromChainId: 42161, toChainId: 8453 },
 *     { fromChainId: 10, toChainId: 8453 },
 *     { fromChainId: 137, toChainId: 8453 },
 *   ],
 *   destination: '0x...',
 * });
 * ```
 *
 * @packageDocumentation
 */

import {
  type Address,
  type Hex,
  type Account,
  type WalletClient,
  createWalletClient,
  http,
} from 'viem';
import { ZeroDust } from './client.js';
import type {
  ZeroDustConfig,
  QuoteResponse,
  SweepStatusResponse,
  ChainBalance,
  EIP7702Authorization,
} from './types.js';
import { ZeroDustError } from './errors.js';

// ============ Types ============

/**
 * Configuration for ZeroDustAgent
 */
export interface ZeroDustAgentConfig extends ZeroDustConfig {
  /**
   * Viem account (from privateKeyToAccount or similar)
   * This account will be used for all signing operations.
   */
  account: Account;

  /**
   * Optional: Custom RPC URLs per chain
   * If not provided, uses public RPC endpoints
   */
  rpcUrls?: Record<number, string>;
}

/**
 * Request for a single sweep
 */
export interface AgentSweepRequest {
  /** Source chain ID */
  fromChainId: number;
  /** Destination chain ID (same as fromChainId for same-chain) */
  toChainId: number;
  /** Destination address (defaults to agent's address) */
  destination?: Address;
}

/**
 * Request for batch sweeping multiple chains
 */
export interface AgentBatchSweepRequest {
  /** Array of chains to sweep */
  sweeps: Array<{
    fromChainId: number;
    toChainId?: number; // Defaults to consolidateToChainId
  }>;
  /** Destination address for all sweeps (defaults to agent's address) */
  destination?: Address;
  /** Default destination chain for all sweeps */
  consolidateToChainId?: number;
  /** Whether to continue if one sweep fails */
  continueOnError?: boolean;
}

/**
 * Result of a single sweep
 */
export interface AgentSweepResult {
  /** Whether the sweep was successful */
  success: boolean;
  /** Sweep ID (if submitted) */
  sweepId?: string;
  /** Final status (if completed/failed) */
  status?: SweepStatusResponse;
  /** Transaction hash (if completed) */
  txHash?: string;
  /** Error message (if failed) */
  error?: string;
  /** Quote used for the sweep */
  quote?: QuoteResponse;
}

/**
 * Result of a batch sweep
 */
export interface AgentBatchSweepResult {
  /** Total sweeps attempted */
  total: number;
  /** Number of successful sweeps */
  successful: number;
  /** Number of failed sweeps */
  failed: number;
  /** Individual results for each sweep */
  results: Array<AgentSweepResult & { fromChainId: number; toChainId: number }>;
}

/**
 * Options for sweep operations
 */
export interface AgentSweepOptions {
  /** Whether to wait for completion (default: true) */
  waitForCompletion?: boolean;
  /** Timeout for waiting in ms (default: 120000) */
  timeoutMs?: number;
  /** Callback for status updates */
  onStatusChange?: (status: SweepStatusResponse) => void;
}

// ============ Agent Class ============

/**
 * ZeroDust Agent for AI/automated systems
 *
 * This class provides a simplified interface for sweeping native gas tokens
 * when you have direct control over the private key (no wallet UI needed).
 *
 * @example
 * ```typescript
 * import { ZeroDustAgent } from '@zerodust/sdk';
 * import { privateKeyToAccount } from 'viem/accounts';
 *
 * // Initialize with private key
 * const agent = new ZeroDustAgent({
 *   account: privateKeyToAccount(process.env.AGENT_PRIVATE_KEY),
 *   environment: 'mainnet',
 * });
 *
 * // Check sweepable balances
 * const balances = await agent.getSweepableBalances();
 * console.log('Sweepable chains:', balances.map(b => b.chainName));
 *
 * // Sweep all chains to one destination
 * const result = await agent.sweepAll({
 *   toChainId: 8453,  // Base
 *   destination: '0x...',
 * });
 * ```
 */
export class ZeroDustAgent {
  /** Underlying SDK client */
  public readonly client: ZeroDust;

  /** Agent's account */
  public readonly account: Account;

  /** Agent's address */
  public readonly address: Address;

  /** Custom RPC URLs */
  private readonly rpcUrls: Record<number, string>;

  /**
   * Create a new ZeroDustAgent
   *
   * @param config - Agent configuration including account and SDK options
   */
  constructor(config: ZeroDustAgentConfig) {
    this.account = config.account;
    this.address = config.account.address;
    this.rpcUrls = config.rpcUrls ?? {};

    // Create underlying client (filter out undefined values for exactOptionalPropertyTypes)
    const clientConfig: Record<string, unknown> = {};
    if (config.environment !== undefined) clientConfig.environment = config.environment;
    if (config.baseUrl !== undefined) clientConfig.baseUrl = config.baseUrl;
    if (config.apiKey !== undefined) clientConfig.apiKey = config.apiKey;
    if (config.timeout !== undefined) clientConfig.timeout = config.timeout;
    if (config.retries !== undefined) clientConfig.retries = config.retries;
    this.client = new ZeroDust(clientConfig as ZeroDustConfig);
  }

  // ============ Balance Methods ============

  /**
   * Get all balances for the agent's address
   *
   * @returns Balances across all chains
   */
  async getBalances() {
    return this.client.getBalances(this.address);
  }

  /**
   * Get only sweepable balances (above minimum threshold)
   *
   * @returns Array of sweepable chain balances
   */
  async getSweepableBalances(): Promise<ChainBalance[]> {
    const { chains } = await this.getBalances();
    return chains.filter((b) => b.canSweep);
  }

  /**
   * Get balance on a specific chain
   *
   * @param chainId - Chain ID
   * @returns Balance information
   */
  async getBalance(chainId: number) {
    return this.client.getBalance(this.address, chainId);
  }

  // ============ Sweep Methods ============

  /**
   * Sweep a single chain
   *
   * This method handles the entire flow:
   * 1. Get a quote
   * 2. Sign the EIP-7702 authorization
   * 3. Sign the EIP-712 SweepIntent
   * 4. Submit the sweep
   * 5. (Optionally) Wait for completion
   *
   * @param request - Sweep parameters
   * @param options - Sweep options
   * @returns Sweep result
   *
   * @example
   * ```typescript
   * const result = await agent.sweep({
   *   fromChainId: 42161,  // Arbitrum
   *   toChainId: 8453,     // Base
   *   destination: '0x...',
   * });
   *
   * if (result.success) {
   *   console.log('Sweep completed! TX:', result.txHash);
   * }
   * ```
   */
  async sweep(
    request: AgentSweepRequest,
    options: AgentSweepOptions = {}
  ): Promise<AgentSweepResult> {
    const { waitForCompletion = true, timeoutMs = 120000, onStatusChange } = options;
    const destination = request.destination ?? this.address;

    try {
      // 1. Get quote
      const quote = await this.client.getQuote({
        fromChainId: request.fromChainId,
        toChainId: request.toChainId,
        userAddress: this.address,
        destination,
      });

      // 2. Create authorization (get typed data)
      const { typedData, contractAddress } = await this.client.createAuthorization(quote.quoteId);

      // 3. Sign EIP-712 typed data
      const signature = await this.signTypedData(typedData);

      // 4. Sign EIP-7702 delegation authorization (nonce auto-fetched from chain)
      const eip7702Authorization = await this.signEIP7702Authorization({
        contractAddress,
        chainId: request.fromChainId,
      });

      // 5. Sign revoke authorization (nonce = delegation nonce + 1)
      const revokeAuthorization = await this.signEIP7702Authorization({
        contractAddress: '0x0000000000000000000000000000000000000000' as Address,
        chainId: request.fromChainId,
        nonce: eip7702Authorization.nonce + 1,
      });

      // 6. Submit sweep
      const sweep = await this.client.submitSweep({
        quoteId: quote.quoteId,
        signature,
        eip7702Authorization,
        revokeAuthorization,
      });

      // 7. Wait for completion if requested
      if (waitForCompletion) {
        const waitOpts: { timeoutMs: number; onStatusChange?: (status: SweepStatusResponse) => void } = {
          timeoutMs,
        };
        if (onStatusChange) waitOpts.onStatusChange = onStatusChange;
        const status = await this.client.waitForSweep(sweep.sweepId, waitOpts);

        const result: AgentSweepResult = {
          success: status.status === 'completed',
          sweepId: sweep.sweepId,
          status,
          quote,
        };
        if (status.txHash) result.txHash = status.txHash;
        if (status.status === 'failed' && status.errorMessage) result.error = status.errorMessage;
        return result;
      }

      return {
        success: true,
        sweepId: sweep.sweepId,
        quote,
      };
    } catch (error) {
      if (error instanceof ZeroDustError) {
        return {
          success: false,
          error: error.message,
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Sweep multiple chains in batch
   *
   * @param request - Batch sweep parameters
   * @param options - Sweep options
   * @returns Batch sweep result
   *
   * @example
   * ```typescript
   * const result = await agent.batchSweep({
   *   sweeps: [
   *     { fromChainId: 42161 },  // Arbitrum
   *     { fromChainId: 10 },     // Optimism
   *     { fromChainId: 137 },    // Polygon
   *   ],
   *   consolidateToChainId: 8453,  // All to Base
   *   destination: '0x...',
   *   continueOnError: true,
   * });
   *
   * console.log(`${result.successful}/${result.total} sweeps completed`);
   * ```
   */
  async batchSweep(
    request: AgentBatchSweepRequest,
    options: AgentSweepOptions = {}
  ): Promise<AgentBatchSweepResult> {
    const destination = request.destination ?? this.address;
    const defaultToChainId = request.consolidateToChainId ?? 8453; // Default to Base
    const continueOnError = request.continueOnError ?? true;

    const results: AgentBatchSweepResult['results'] = [];

    for (const sweepReq of request.sweeps) {
      const toChainId = sweepReq.toChainId ?? defaultToChainId;

      try {
        const result = await this.sweep(
          {
            fromChainId: sweepReq.fromChainId,
            toChainId,
            destination,
          },
          options
        );

        results.push({
          ...result,
          fromChainId: sweepReq.fromChainId,
          toChainId,
        });

        if (!result.success && !continueOnError) {
          break;
        }
      } catch (error) {
        const errorResult: AgentBatchSweepResult['results'][0] = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          fromChainId: sweepReq.fromChainId,
          toChainId,
        };
        results.push(errorResult);

        if (!continueOnError) {
          break;
        }
      }
    }

    return {
      total: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  /**
   * Sweep all sweepable balances to one chain
   *
   * @param options - Where to send all funds
   * @param sweepOptions - Sweep options
   * @returns Batch sweep result
   *
   * @example
   * ```typescript
   * // Exit all chains and consolidate to Base
   * const result = await agent.sweepAll({
   *   toChainId: 8453,
   * });
   * ```
   */
  async sweepAll(
    options: {
      toChainId: number;
      destination?: Address;
      continueOnError?: boolean;
    },
    sweepOptions: AgentSweepOptions = {}
  ): Promise<AgentBatchSweepResult> {
    const sweepable = await this.getSweepableBalances();

    // Filter out the destination chain (can't sweep to self if toChainId === fromChainId)
    // Actually, same-chain sweeps are valid, but we might want to skip if already on dest chain
    const sweeps = sweepable.map((b) => ({
      fromChainId: b.chainId,
      toChainId: options.toChainId,
    }));

    return this.batchSweep(
      {
        sweeps,
        destination: options.destination ?? this.address,
        consolidateToChainId: options.toChainId,
        continueOnError: options.continueOnError ?? true,
      },
      sweepOptions
    );
  }

  // ============ Signing Methods ============

  /**
   * Sign EIP-712 typed data
   * @internal
   */
  private async signTypedData(typedData: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: Address;
    };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex> {
    const walletClient = this.getWalletClient(typedData.domain.chainId);

    const signature = await walletClient.signTypedData({
      account: this.account,
      domain: typedData.domain,
      types: typedData.types as Record<string, Array<{ name: string; type: string }>>,
      primaryType: typedData.primaryType as 'SweepIntent',
      message: typedData.message,
    });

    return signature;
  }

  /**
   * Sign EIP-7702 authorization
   * @internal
   */
  private async signEIP7702Authorization(params: {
    contractAddress: Address;
    chainId: number;
    nonce?: number;
  }): Promise<EIP7702Authorization> {
    // Get wallet client for the chain
    const walletClient = this.getWalletClient(params.chainId);

    // Sign the authorization (nonce auto-fetched from chain if not provided)
    const authParams: Record<string, unknown> = {
      account: this.account,
      contractAddress: params.contractAddress,
      chainId: params.chainId,
    };
    if (params.nonce !== undefined) {
      authParams.nonce = params.nonce;
    }
    const authorization = await walletClient.signAuthorization(authParams as never);

    return {
      chainId: authorization.chainId,
      contractAddress: (authorization as unknown as { address: Address }).address ?? params.contractAddress,
      nonce: Number(authorization.nonce),
      yParity: (authorization.yParity ?? 0) as 0 | 1,
      r: authorization.r,
      s: authorization.s,
    };
  }

  /**
   * Get wallet client for a chain
   * @internal
   */
  private getWalletClient(chainId: number): WalletClient {
    const rpcUrl = this.rpcUrls[chainId] ?? this.getDefaultRpcUrl(chainId);

    return createWalletClient({
      account: this.account,
      transport: http(rpcUrl),
    });
  }

  /**
   * Get default public RPC URL for a chain
   * @internal
   */
  private getDefaultRpcUrl(chainId: number): string {
    // Map of chain IDs to default public RPC URLs
    const defaults: Record<number, string> = {
      1: 'https://eth.llamarpc.com',
      10: 'https://mainnet.optimism.io',
      56: 'https://bsc-dataseed.binance.org',
      100: 'https://rpc.gnosischain.com',
      137: 'https://polygon-rpc.com',
      8453: 'https://mainnet.base.org',
      42161: 'https://arb1.arbitrum.io/rpc',
      // Testnets
      11155111: 'https://rpc.sepolia.org',
      84532: 'https://sepolia.base.org',
      421614: 'https://sepolia-rollup.arbitrum.io/rpc',
    };

    return defaults[chainId] ?? `https://rpc.ankr.com/eth`;
  }
}

// ============ Factory Function ============

/**
 * Create a ZeroDustAgent from a private key
 *
 * Convenience function for creating an agent directly from a private key hex string.
 *
 * @param privateKey - Private key as hex string (with or without 0x prefix)
 * @param config - Additional configuration options
 * @returns ZeroDustAgent instance
 *
 * @example
 * ```typescript
 * import { createAgentFromPrivateKey } from '@zerodust/sdk';
 *
 * const agent = createAgentFromPrivateKey(
 *   process.env.AGENT_PRIVATE_KEY,
 *   { environment: 'mainnet' }
 * );
 *
 * const result = await agent.sweep({
 *   fromChainId: 42161,
 *   toChainId: 8453,
 * });
 * ```
 */
export async function createAgentFromPrivateKey(
  privateKey: Hex,
  config: Omit<ZeroDustAgentConfig, 'account'> = {}
): Promise<ZeroDustAgent> {
  // Dynamic import to avoid bundling viem/accounts when not needed
  const { privateKeyToAccount } = await import('viem/accounts');

  const account = privateKeyToAccount(privateKey);

  return new ZeroDustAgent({
    ...config,
    account,
  });
}
