import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Simple logger implementation
const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] ${message}`, data || ''),
  error: (message: string, data?: any) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message: string, data?: any) => console.warn(`[WARN] ${message}`, data || ''),
  debug: (message: string, data?: any) => console.debug(`[DEBUG] ${message}`, data || '')
};

// Simple Token Store implementation
class TokenStore {
  private static instance: TokenStore;
  private tokens: Map<string, any> = new Map();

  private constructor() {
    // Manually add common tokens
    this.tokens.set('SNEK', {
      ticker: 'SNEK',
      name: 'Snek',
      unit: '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b',
      policy_id: 'f43a62fdc3965df486de8a0d32fe800963589c41b38946602a0dc535',
      asset_name: '534e454b',
      source: 'hardcoded',
      last_updated: Date.now(),
      active: true
    });

    this.tokens.set('MISTER', {
      ticker: 'MISTER',
      name: 'MISTER',
      unit: '7529bed52d81a20e69c6dd447dd9cc0293daf4577f08d7ed2d8ab0814d4953544552',
      policy_id: '7529bed52d81a20e69c6dd447dd9cc0293daf4577f08d7ed2d8ab081',
      asset_name: '4d4953544552',
      source: 'hardcoded',
      last_updated: Date.now(),
      active: true
    });

    this.tokens.set('MIN', {
      ticker: 'MIN',
      name: 'MIN',
      unit: '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e',
      policy_id: '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6',
      asset_name: '4d494e',
      source: 'hardcoded',
      last_updated: Date.now(),
      active: true
    });

    this.tokens.set('HOSKY', {
      ticker: 'HOSKY',
      name: 'Hosky Token',
      unit: 'a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59',
      policy_id: 'a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235',
      asset_name: '484f534b59',
      source: 'hardcoded',
      last_updated: Date.now(),
      active: true
    });

    logger.info('Initialized TokenStore with hardcoded tokens');
  }

  static getInstance(): TokenStore {
    if (!TokenStore.instance) {
      TokenStore.instance = new TokenStore();
    }
    return TokenStore.instance;
  }

  getTokenUnit(ticker: string): string | null {
    const token = this.tokens.get(ticker.toUpperCase());
    return token ? token.unit : null;
  }

  resolveToken(ticker: string): any {
    return this.tokens.get(ticker.toUpperCase()) || null;
  }

  addToken(token: any): void {
    this.tokens.set(token.ticker.toUpperCase(), token);
  }
}

// Enhanced Token Store implementation
class EnhancedTokenStore {
  private static instance: EnhancedTokenStore;
  private tokens: Map<string, any> = new Map();

  private constructor() {
    // Initialize with same tokens as TokenStore
    const tokenStore = TokenStore.getInstance();
    this.tokens = new Map(tokenStore['tokens']);
  }

  static getInstance(): EnhancedTokenStore {
    if (!EnhancedTokenStore.instance) {
      EnhancedTokenStore.instance = new EnhancedTokenStore();
    }
    return EnhancedTokenStore.instance;
  }

  async getTokenUnit(ticker: string): Promise<string | null> {
    const token = this.tokens.get(ticker.toUpperCase());
    return token ? token.unit : null;
  }

  async resolveToken(ticker: string): Promise<any> {
    return this.tokens.get(ticker.toUpperCase()) || null;
  }

  addToken(token: any): void {
    this.tokens.set(token.ticker.toUpperCase(), token);
  }
}

// Initialize the enhanced token store
const tokenLookupService = EnhancedTokenStore.getInstance();

const TAPTOOLS_API_KEY = process.env.TAPTOOLS_API_KEY || "WghkJaZlDWYdQFsyt3uiLdTIOYnR5uhO";
const TAPTOOLS_BASE_URL = "https://openapi.taptools.io/api/v1";

// Cache implementation
class TotalHoldersCache {
  private static instance: TotalHoldersCache;
  private cache: Map<string, { data: any; timestamp: number }>;
  private readonly TTL = 300000; // 5 minutes cache

  private constructor() {
    this.cache = new Map();
  }

  static getInstance(): TotalHoldersCache {
    if (!TotalHoldersCache.instance) {
      TotalHoldersCache.instance = new TotalHoldersCache();
    }
    return TotalHoldersCache.instance;
  }

  get(key: string): any {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.TTL) {
      return cached.data;
    }
    return null;
  }

  set(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  // Method to get the age of cached data
  getAge(key: string): string {
    const cached = this.cache.get(key);
    if (!cached) return 'no cache';
    return Math.round((Date.now() - cached.timestamp) / 1000) + 's';
  }

  // Clear the cache
  clear(): void {
    this.cache.clear();
  }
}

// API Client
class TapToolsAPI {
  private static instance: TapToolsAPI;
  private cache: TotalHoldersCache;

  private constructor() {
    this.cache = TotalHoldersCache.getInstance();
  }

  static getInstance(): TapToolsAPI {
    if (!TapToolsAPI.instance) {
      TapToolsAPI.instance = new TapToolsAPI();
    }
    return TapToolsAPI.instance;
  }

  // Public helper to expose cache age without accessing private property
  getCacheAge(key: string): string {
    return this.cache.getAge(key);
  }

  private async fetchWithAuth(endpoint: string, params: Record<string, string> = {}): Promise<any> {
    const url = new URL(`${TAPTOOLS_BASE_URL}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));

    const response = await fetch(url.toString(), {
      headers: {
        'x-api-key': TAPTOOLS_API_KEY,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(`TapTools API Error: ${response.status} - ${errorData?.error || response.statusText}`);
    }

    return response.json();
  }

  async getTotalHolders(ticker: string): Promise<any> {
    try {
      // Get the token unit from the EnhancedTokenStore
      let unit = await tokenLookupService.getTokenUnit(ticker);

      if (unit) {
        logger.info(`Found unit for ${ticker} in EnhancedTokenStore: ${unit}`);
      } else {
        // If not found in enhanced store, try the old token store as fallback
        const oldToken = TokenStore.getInstance().getTokenUnit(ticker);
        if (oldToken) {
          unit = oldToken;
          logger.info(`Found unit for ${ticker} in legacy TokenStore: ${unit}`);
        } else {
          // If still not found, throw error
          throw new Error(`Could not resolve token unit for ticker: ${ticker}. Token not found in any data source.`);
        }
      }

      // Now make the API request with the unit we found
      const cacheKey = `total-holders-${unit}`;
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;

      // Extract asset name from unit if available
      let assetName = '';
      const token = await tokenLookupService.resolveToken(ticker);
      if (token && token.asset_name) {
        assetName = token.asset_name;
        logger.info(`Extracted asset name for ${ticker}: ${assetName}`);
      } else {
        // Try to construct asset name from ticker (convert to hex)
        assetName = Buffer.from(ticker.toUpperCase()).toString('hex');
        logger.info(`Constructed asset name from ticker: ${assetName}`);
      }

      // Construct full unit with policy ID and asset name
      const fullUnit = unit + assetName;
      logger.info(`Calling TapTools API with unit: ${fullUnit}`);

      // Try with the full unit first
      try {
        const response = await this.fetchWithAuth('/token/holders', {
          unit: fullUnit
        });

        // Cache and return the result
        this.cache.set(cacheKey, response);
        return response;
      } catch (error) {
        logger.warn(`Error getting total holders with full unit: ${error instanceof Error ? error.message : 'Unknown error'}`);

        // If that fails, try with just the policy ID
        try {
          const response = await this.fetchWithAuth('/token/holders', {
            unit
          });

          // Cache and return the result
          this.cache.set(cacheKey, response);
          return response;
        } catch (secondError) {
          logger.error(`Error getting total holders with policy ID: ${secondError instanceof Error ? secondError.message : 'Unknown error'}`);
          throw secondError;
        }
      }
    } catch (error) {
      logger.error('Failed to fetch total holders:', {
        ticker,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

// Create the Total Holders Tool
export const CardanoTotalHolders = createTool({
  id: 'cardano-total-holders',
  description: 'Retrieves the total number of holders for a specific Cardano token using its ticker symbol',
  inputSchema: z.object({
    ticker: z.string()
      .describe('Token ticker (e.g., "LENFI", "MIN", "AGIX")')
  }),
  async execute(input: { context?: Record<string, any>; args?: Record<string, any> }) {
    try {
      const api = TapToolsAPI.getInstance();
      const params = input?.context || input?.args || {};

      if (!params.ticker) {
        throw new Error('Invalid input: ticker is required');
      }

      // Log request for debugging
      logger.info('CardanoTotalHolders request:', {
        ticker: params.ticker
      });

      const holdersData = await api.getTotalHolders(params.ticker);

      // Log the response for debugging
      logger.info('TapTools API response:', JSON.stringify(holdersData));

      // Get token metadata for additional context
      const token = await tokenLookupService.resolveToken(params.ticker);

      // Get the cache key for age calculation
      const cacheKey = `total-holders-${token?.unit || 'unknown'}`;

      return {
        token: {
          ticker: params.ticker,
          name: token?.name || 'Unknown',
          unit: token?.unit || 'Unknown',
          policy_id: token?.policy_id
        },
        holders: {
          total: holdersData.holders || 0
        },
        metadata: {
          last_updated: new Date().toISOString(),
          source: 'TapTools API'
        },
        cache_info: {
          age: api.getCacheAge(cacheKey)
        }
      };
    } catch (error: unknown) {
      logger.error('Error in CardanoTotalHolders:', {
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        error: true,
        message: error instanceof Error ? error.message : 'Unknown error in total holders lookup',
        suggestion: 'Please verify your input ticker and try again.'
      };
    }
  }
});
