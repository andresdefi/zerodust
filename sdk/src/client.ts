/**
 * @fileoverview Main ZeroDust SDK client
 *
 * This is the primary entry point for the SDK.
 * It provides methods for all ZeroDust operations:
 * - Getting chain information
 * - Fetching balances
 * - Creating sweep quotes
 * - Submitting sweeps
 * - Tracking sweep status
 */

import type {
  ZeroDustConfig,
  Environment,
  Chain,
  ChainsResponse,
  Destination,
  DestinationsResponse,
  ChainBalance,
  BalancesResponse,
  QuoteRequest,
  QuoteResponse,
  SweepIntentFields,
  AuthorizationResponse,
  SweepRequest,
  SweepResponse,
  SweepStatusResponse,
  ListSweepsOptions,
  SweepsListResponse,
  ApiErrorResponse,
} from './types.js';
import {
  ZeroDustError,
  NetworkError,
  TimeoutError,
  createErrorFromResponse,
  codeForStatus,
  wrapError,
} from './errors.js';
import {
  validateAddress,
  validateChainId,
  validateQuoteRequest,
  validateUuid,
  validateSignature,
  validateEIP7702Authorization,
} from './utils/validation.js';
import { RESTORABLE_DELEGATES, ZERO_ADDRESS } from './utils/signature.js';

// ============ Constants ============

/**
 * Default API base URLs
 */
const API_URLS: Record<Environment, string> = {
  mainnet: 'https://api.zerodust.xyz',
  testnet: 'https://api.zerodust.xyz', // TODO: separate testnet backend when available
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<Omit<ZeroDustConfig, 'apiKey' | 'baseUrl'>> = {
  environment: 'testnet',
  timeout: 30000,
  retries: 3,
};

// ============ HTTP Client ============

interface HttpClientOptions {
  baseUrl: string;
  timeout: number;
  retries: number;
  apiKey?: string;
}

/**
 * Simple HTTP client with retry logic
 */
class HttpClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly retries: number;
  private readonly headers: Record<string, string>;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeout = options.timeout;
    this.retries = options.retries;
    this.headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (options.apiKey) {
      this.headers['X-API-Key'] = options.apiKey;
    }
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Backoff for attempt n (0-based): 1 s, 2 s, 4 s ... at most 10 s */
  private backoffMs(retriesLeft: number): number {
    return Math.min(1000 * 2 ** (this.retries - retriesLeft), 10000);
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    retriesLeft: number
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, options);
    } catch (error) {
      // Don't retry on AbortError (our own timeout) — fail fast instead of compounding latency
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (retriesLeft > 0 && !isAbort) {
        // Exponential backoff
        const delay = Math.min(1000 * 2 ** (this.retries - retriesLeft), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.fetchWithRetry(url, options, retriesLeft - 1);
      }
      throw error;
    }
    // A rate-limited request was not processed, so it is safe to send again,
    // POST included; a GET is also retried on a gateway error.
    const retryable = response.status === 429 || (options.method === 'GET' && [502, 503, 504].includes(response.status));
    if (retryable && retriesLeft > 0) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : this.backoffMs(retriesLeft);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.fetchWithRetry(url, options, retriesLeft - 1);
    }
    return response;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          searchParams.set(key, String(value));
        }
      }
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    try {
      const response = await this.fetchWithRetry(
        url,
        { method: 'GET', headers: this.headers },
        this.retries
      );
      return this.handleResponse<T>(response);
    } catch (error) {
      throw this.handleFetchError(error, 'GET', path);
    }
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    try {
      const options: RequestInit = {
        method: 'POST',
        headers: this.headers,
      };
      if (body !== undefined) {
        options.body = JSON.stringify(body);
      }
      const response = await this.fetchWithRetry(url, options, this.retries);
      return this.handleResponse<T>(response);
    } catch (error) {
      throw this.handleFetchError(error, 'POST', path);
    }
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type');
    const isJson = contentType?.includes('application/json');

    if (!response.ok) {
      if (isJson) {
        const errorBody = (await response.json()) as ApiErrorResponse;
        throw createErrorFromResponse(response.status, errorBody);
      }
      const text = await response.text();
      throw new ZeroDustError(
        codeForStatus(response.status),
        `HTTP ${response.status}: ${text}`,
        { statusCode: response.status },
        response.status
      );
    }

    if (!isJson) {
      throw new ZeroDustError(
        'INTERNAL_ERROR',
        'Expected JSON response from API',
        { contentType }
      );
    }

    return response.json() as Promise<T>;
  }

  private handleFetchError(error: unknown, method: string, path: string): ZeroDustError {
    if (error instanceof ZeroDustError) {
      return error;
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return new TimeoutError(this.timeout, { method, path });
      }
      return new NetworkError(`${method} ${path} failed: ${error.message}`, {
        method,
        path,
        originalError: error.message,
      });
    }

    return wrapError(error, `${method} ${path} failed`);
  }
}

// ============ ZeroDust Client ============

/**
 * ZeroDust SDK client
 *
 * @example
 * ```typescript
 * import { ZeroDust } from '@zerodust/sdk';
 *
 * const zerodust = new ZeroDust({ environment: 'mainnet' });
 *
 * // Get user balances
 * const balances = await zerodust.getBalances('0x1234...');
 *
 * // Get a quote
 * const quote = await zerodust.getQuote({
 *   fromChainId: 42161,
 *   toChainId: 8453,
 *   userAddress: '0x1234...',
 *   destination: '0x5678...',
 * });
 *
 * // Create authorization for signing
 * const { typedData } = await zerodust.createAuthorization(quote.quoteId);
 *
 * // User signs the typedData with their wallet...
 * // Then submit the sweep
 * const sweep = await zerodust.submitSweep({
 *   quoteId: quote.quoteId,
 *   signature: '0x...',
 *   eip7702Authorization: {...},
 * });
 *
 * // Check status
 * const status = await zerodust.getSweepStatus(sweep.sweepId);
 * ```
 */
export class ZeroDust {
  private readonly http: HttpClient;
  private readonly environment: Environment;
  private cachedChains: Chain[] | null = null;
  private cachedChainsAt: number = 0;
  private readonly chainsCacheTtl = 60000; // 1 minute

  /**
   * Create a new ZeroDust client
   *
   * @param config - Configuration options
   */
  constructor(config: ZeroDustConfig = {}) {
    this.environment = config.environment ?? DEFAULT_CONFIG.environment;

    const baseUrl =
      config.baseUrl ?? API_URLS[this.environment] ?? API_URLS.testnet;

    const httpOptions: HttpClientOptions = {
      baseUrl,
      timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
      retries: config.retries ?? DEFAULT_CONFIG.retries,
    };
    if (config.apiKey) {
      httpOptions.apiKey = config.apiKey;
    }
    this.http = new HttpClient(httpOptions);
  }

  // ============ Chain Methods ============

  /**
   * Get list of supported chains
   *
   * @param testnet - Query testnet chains instead of mainnet (default: false)
   * @returns List of supported chains
   *
   * @example
   * const chains = await zerodust.getChains();
   * chains.forEach(c => console.log(c.name, c.chainId));
   */
  async getChains(testnet = false): Promise<Chain[]> {
    // Check cache
    if (
      this.cachedChains &&
      Date.now() - this.cachedChainsAt < this.chainsCacheTtl
    ) {
      return this.cachedChains;
    }

    const response = await this.http.get<ChainsResponse>('/chains', { testnet });

    // Update cache
    this.cachedChains = response.chains;
    this.cachedChainsAt = Date.now();

    return response.chains;
  }

  /**
   * Get a specific chain by ID
   *
   * @param chainId - Chain ID to look up
   * @returns Chain information
   * @throws {ZeroDustError} With code `NOT_FOUND` if the API does not serve the chain
   *
   * @example
   * const base = await zerodust.getChain(8453);
   * console.log(base.name); // 'Base'
   */
  async getChain(chainId: number): Promise<Chain> {
    const validatedChainId = validateChainId(chainId);
    return this.http.get<Chain>(`/chains/${validatedChainId}`);
  }

  /**
   * Chains a cross-chain sweep from `fromChainId` can deliver native gas to.
   *
   * Not limited to ZeroDust chains: any EVM chain a bridge serves from the
   * source is listed (e.g. HyperEVM, Avalanche). This is what bridges advertise;
   * `getQuote` confirms a route live.
   *
   * @param fromChainId - Source chain (must be a ZeroDust chain)
   * @returns Destinations sorted by name
   *
   * @example
   * const destinations = await zerodust.getDestinations(42161);
   * const hyperEvm = destinations.find(d => d.chainId === 999); // delivers HYPE
   */
  async getDestinations(fromChainId: number): Promise<Destination[]> {
    const validatedChainId = validateChainId(fromChainId);
    const response = await this.http.get<DestinationsResponse>('/destinations', { fromChainId: validatedChainId });
    return response.destinations;
  }

  // ============ Balance Methods ============

  /**
   * Get balances for an address across all supported chains
   *
   * @param address - User's address
   * @param testnet - Query testnet chains instead of mainnet (default: false)
   * @returns Balances for each chain
   *
   * @example
   * const balances = await zerodust.getBalances('0x1234...');
   * const sweepable = balances.chains.filter(c => c.canSweep);
   */
  async getBalances(address: string, testnet = false): Promise<BalancesResponse> {
    const validatedAddress = validateAddress(address, 'address');
    return this.http.get<BalancesResponse>(`/balances/${validatedAddress}`, {
      testnet,
    });
  }

  /**
   * Get balance for an address on a specific chain
   *
   * @param address - User's address
   * @param chainId - Chain ID
   * @returns Balance information
   *
   * @example
   * const balance = await zerodust.getBalance('0x1234...', 8453);
   * if (balance.canSweep) {
   *   console.log('Can sweep:', balance.balanceFormatted);
   * }
   */
  async getBalance(address: string, chainId: number): Promise<ChainBalance> {
    const validatedAddress = validateAddress(address, 'address');
    const validatedChainId = validateChainId(chainId);
    return this.http.get<ChainBalance>(
      `/balances/${validatedAddress}/${validatedChainId}`
    );
  }

  // ============ Quote Methods ============

  /**
   * Get a quote for sweeping
   *
   * @param params - Quote parameters
   * @returns Quote with fee breakdown and intent fields
   *
   * @example
   * // Same-chain sweep
   * const quote = await zerodust.getQuote({
   *   fromChainId: 8453,
   *   toChainId: 8453,
   *   userAddress: '0x1234...',
   *   destination: '0x5678...',
   * });
   *
   * // Cross-chain sweep (Arbitrum → Base)
   * const quote = await zerodust.getQuote({
   *   fromChainId: 42161,
   *   toChainId: 8453,
   *   userAddress: '0x1234...',
   *   destination: '0x5678...',
   * });
   */
  async getQuote(params: QuoteRequest): Promise<QuoteResponse> {
    const validated = validateQuoteRequest(params);
    return this.http.get<QuoteResponse>('/quote', {
      fromChainId: validated.fromChainId,
      toChainId: validated.toChainId,
      userAddress: validated.userAddress,
      destination: validated.destination,
    });
  }

  // ============ Authorization Methods ============

  /**
   * Create EIP-712 typed data for signing
   *
   * @param quoteId - Quote ID from getQuote()
   * @returns Typed data to sign and contract address for delegation
   *
   * @example
   * const { typedData, contractAddress } = await zerodust.createAuthorization(quote.quoteId);
   *
   * // Sign with viem
   * const signature = await walletClient.signTypedData(typedData);
   *
   * // Or with ethers
   * const signature = await signer._signTypedData(
   *   typedData.domain,
   *   typedData.types,
   *   typedData.message
   * );
   */
  async createAuthorization(quoteId: string): Promise<AuthorizationResponse> {
    const validatedQuoteId = validateUuid(quoteId, 'quoteId');
    return this.http.post<AuthorizationResponse>('/authorization', {
      quoteId: validatedQuoteId,
    });
  }

  /**
   * Bind a Relay deposit you requested from Relay yourself into a Relay-routed quote
   * (POST /quote/:quoteId/relay-route). Relay keeps the recipient on its servers and the deposit
   * calldata only names an id, so only a deposit you requested pays the address you set.
   * `ZeroDustAgent` does this for every Relay route; check `intent.callData` is your deposit.
   */
  async bindRelayRoute(
    quoteId: string,
    route: { callTarget: string; callData: string; requestId: string; routeToken: string }
  ): Promise<{ quoteId: string; intent: SweepIntentFields & { callData?: string } }> {
    const validatedQuoteId = validateUuid(quoteId, 'quoteId');
    return this.http.post(`/quote/${validatedQuoteId}/relay-route`, route);
  }

  // ============ Sweep Methods ============

  /**
   * Submit a signed sweep for execution
   *
   * @param request - Sweep request with signatures
   * @returns Sweep ID and initial status
   *
   * @example
   * const sweep = await zerodust.submitSweep({
   *   quoteId: quote.quoteId,
   *   signature,
   *   eip7702Authorization: {
   *     chainId: 8453,
   *     contractAddress: '0x...',
   *     nonce: 0,
   *     yParity: 0,
   *     r: '0x...',
   *     s: '0x...',
   *   },
   *   // Required: delegates to address(0), same chain, nonce + 1, so the
   *   // delegation is removed right after the sweep (its gas is in the fee)
   *   revokeAuthorization: {...},
   * });
   */
  async submitSweep(request: SweepRequest): Promise<SweepResponse> {
    const validatedQuoteId = validateUuid(request.quoteId, 'quoteId');
    const validatedSignature = validateSignature(request.signature);
    const validatedAuth = validateEIP7702Authorization(request.eip7702Authorization);

    // Required since 0.5.4 (and by the API): without it the wallet would stay delegated
    if (!request.revokeAuthorization) {
      throw new ZeroDustError(
        'INVALID_REQUEST',
        'revokeAuthorization is required: an EIP-7702 authorization delegating to address(0) on the same chain with nonce + 1. ZeroDustAgent signs it for you.'
      );
    }
    const validatedRevokeAuth = validateEIP7702Authorization(request.revokeAuthorization);
    // address(0), or back to a known smart-account delegate (MetaMask's); the API checks the
    // wallet is delegated to that delegate now
    const closing = validatedRevokeAuth.contractAddress.toLowerCase();
    if ((closing !== ZERO_ADDRESS.toLowerCase() && !RESTORABLE_DELEGATES.some((d) => d.toLowerCase() === closing))
      || validatedRevokeAuth.chainId !== validatedAuth.chainId
      || validatedRevokeAuth.nonce !== validatedAuth.nonce + 1) {
      throw new ZeroDustError(
        'INVALID_REQUEST',
        'revokeAuthorization must delegate to address(0) (or back to MetaMask\'s smart-account delegate) on the same chain as the sweep, with nonce = delegation nonce + 1'
      );
    }

    return this.http.post<SweepResponse>('/sweep', {
      quoteId: validatedQuoteId,
      signature: validatedSignature,
      eip7702Authorization: validatedAuth,
      revokeAuthorization: validatedRevokeAuth,
    });
  }

  /**
   * Get the status of a sweep
   *
   * @param sweepId - Sweep ID from submitSweep()
   * @returns Current sweep status and details
   *
   * @example
   * const status = await zerodust.getSweepStatus(sweep.sweepId);
   *
   * if (status.status === 'completed') {
   *   console.log('Sweep complete! TX:', status.txHash);
   * } else if (status.status === 'failed') {
   *   console.error('Sweep failed:', status.errorMessage);
   * }
   */
  async getSweepStatus(sweepId: string): Promise<SweepStatusResponse> {
    const validatedSweepId = validateUuid(sweepId, 'sweepId');
    return this.http.get<SweepStatusResponse>(`/sweep/${validatedSweepId}`);
  }

  /**
   * List sweeps for a user address
   *
   * @param address - User's address
   * @param options - Pagination and filter options
   * @returns List of sweeps
   *
   * @example
   * const { sweeps, total } = await zerodust.getSweeps('0x1234...', {
   *   limit: 10,
   *   offset: 0,
   *   status: 'completed',
   * });
   */
  async getSweeps(
    address: string,
    options: ListSweepsOptions = {}
  ): Promise<SweepsListResponse> {
    const validatedAddress = validateAddress(address, 'address');
    const params: Record<string, string | number> = {};

    if (options.limit !== undefined) {
      params['limit'] = Math.min(Math.max(1, options.limit), 100);
    }
    if (options.offset !== undefined) {
      params['offset'] = Math.max(0, options.offset);
    }
    if (options.status !== undefined) {
      params['status'] = options.status;
    }

    return this.http.get<SweepsListResponse>(`/sweeps/${validatedAddress}`, params);
  }

  // ============ Polling Helper ============

  /**
   * Poll for sweep completion
   *
   * Useful for waiting until a sweep reaches a terminal state
   * (completed or failed).
   *
   * @param sweepId - Sweep ID to poll
   * @param options - Polling options
   * @returns Final sweep status
   *
   * @example
   * const finalStatus = await zerodust.waitForSweep(sweep.sweepId, {
   *   intervalMs: 2000,
   *   timeoutMs: 120000,
   *   onStatusChange: (status) => {
   *     console.log('Status:', status.status);
   *   },
   * });
   */
  async waitForSweep(
    sweepId: string,
    options: {
      /** Polling interval in milliseconds (default: 2000) */
      intervalMs?: number;
      /** Timeout in milliseconds (default: 120000) */
      timeoutMs?: number;
      /** Callback on status change */
      onStatusChange?: (status: SweepStatusResponse) => void;
    } = {}
  ): Promise<SweepStatusResponse> {
    const {
      intervalMs = 2000,
      timeoutMs = 120000,
      onStatusChange,
    } = options;

    const startTime = Date.now();
    let lastStatus: string | undefined;

    while (true) {
      let status: SweepStatusResponse;
      try {
        status = await this.getSweepStatus(sweepId);
      } catch (error) {
        // A rate limit or a network blip while polling is not a failed sweep:
        // keep polling until the timeout
        if (!(error instanceof ZeroDustError) || !error.isRetryable() || Date.now() - startTime > timeoutMs) throw error;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        continue;
      }

      // Notify on status change
      if (status.status !== lastStatus) {
        lastStatus = status.status;
        onStatusChange?.(status);
      }

      // Terminal states
      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }

      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        throw new TimeoutError(timeoutMs, {
          sweepId,
          lastStatus: status.status,
        });
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}
