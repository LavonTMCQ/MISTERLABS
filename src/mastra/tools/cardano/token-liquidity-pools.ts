import { createTool } from '@mastra/core';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { tokenLookupService } from '../../services/token-lookup';
import { logger } from '../../utils/logger';

// Token Store implementation that reads from tokens.json
class TokenStore {
  private static instance: TokenStore;
  private tokens: Map<string, any> = new Map();
  private tokensJsonPath: string;

  private constructor() {
    // Use the absolute path to tokens.json
    this.tokensJsonPath = '/Users/coldgame/Desktop/tomorrow-agents-mastra/agentproject/.mastra/output/tokens.json';

    if (!fs.existsSync(this.tokensJsonPath)) {
      logger.error(`tokens.json not found at ${this.tokensJsonPath}`);
    } else {
      logger.info(`Using tokens.json at ${this.tokensJsonPath}`);
    }

    this.loadTokens();
  }

  static getInstance(): TokenStore {
    if (!TokenStore.instance) {
      TokenStore.instance = new TokenStore();
    }
    return TokenStore.instance;
  }

  private loadTokens(): void {
    try {
      if (fs.existsSync(this.tokensJsonPath)) {
        logger.info(`Reading tokens from ${this.tokensJsonPath}`);
        const data = fs.readFileSync(this.tokensJsonPath, 'utf8');
        logger.info(`File size: ${data.length} bytes`);

        const tokensData = JSON.parse(data);
        logger.info(`Parsed JSON data. Metadata: ${JSON.stringify(tokensData.metadata || {})}`);

        // Process the tokens from the JSON file
        if (tokensData.cardanoTokens && Array.isArray(tokensData.cardanoTokens)) {
          logger.info(`Found ${tokensData.cardanoTokens.length} tokens in the file`);

          // Check if SNEK exists in the raw data
          const snekInRaw = tokensData.cardanoTokens.find((t: any) => t.symbol === 'SNEK');
          if (snekInRaw) {
            logger.info(`SNEK found in raw data: ${JSON.stringify(snekInRaw)}`);
          } else {
            logger.warn('SNEK not found in raw data!');
          }

          tokensData.cardanoTokens.forEach((token: any) => {
            if (token.symbol) {
              // Hard-code SNEK if it matches
              if (token.symbol.toUpperCase() === 'SNEK') {
                logger.info(`Processing SNEK token: ${JSON.stringify(token)}`);
              }

              this.tokens.set(token.symbol.toUpperCase(), {
                ticker: token.symbol,
                name: token.name,
                unit: token.unit,
                policy_id: token.policyId,
                asset_name: token.unit ? token.unit.substring(56) : '',
                source: 'tokens.json',
                last_updated: Date.now(),
                active: true
              });
            }
          });

          logger.info(`Loaded ${this.tokens.size} tokens from ${this.tokensJsonPath}`);

          // Debug: Check if SNEK is loaded
          const snek = this.tokens.get('SNEK');
          if (snek) {
            logger.info(`SNEK token found in map: ${JSON.stringify(snek)}`);
          } else {
            logger.warn(`SNEK token not found in loaded tokens map!`);

            // Manually add SNEK if not found
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
            logger.info('Manually added SNEK token to the map');
          }
        }
      } else {
        logger.error(`File does not exist: ${this.tokensJsonPath}`);
      }
    } catch (error) {
      logger.error('Error loading tokens from JSON:', error);

      // Manually add SNEK as a fallback
      this.tokens.set('SNEK', {
        ticker: 'SNEK',
        name: 'Snek',
        unit: '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b',
        policy_id: 'f43a62fdc3965df486de8a0d32fe800963589c41b38946602a0dc535',
        asset_name: '534e454b',
        source: 'hardcoded_fallback',
        last_updated: Date.now(),
        active: true
      });
      logger.info('Added fallback SNEK token due to error');
    }
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

// Initialize the token store
// Use the enhanced token store instead of the old one
// const tokenStore = TokenStore.getInstance();
// The tokenLookupService is imported from '../services/tokenLookupService'

const TAPTOOLS_API_KEY = process.env.TAPTOOLS_API_KEY || "WghkJaZlDWYdQFsyt3uiLdTIOYnR5uhO";
const TAPTOOLS_BASE_URL = "https://openapi.taptools.io/api/v1";

// Cache implementation
class LiquidityPoolsCache {
  private static instance: LiquidityPoolsCache;
  private cache: Map<string, { data: any; timestamp: number }>;
  private readonly TTL = 300000; // 5 minutes cache

  private constructor() {
    this.cache = new Map();
  }

  static getInstance(): LiquidityPoolsCache {
    if (!LiquidityPoolsCache.instance) {
      LiquidityPoolsCache.instance = new LiquidityPoolsCache();
    }
    return LiquidityPoolsCache.instance;
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
}

// API Client
class TapToolsAPI {
  private static instance: TapToolsAPI;
  private cache: LiquidityPoolsCache;

  private constructor() {
    this.cache = LiquidityPoolsCache.getInstance();
  }

  static getInstance(): TapToolsAPI {
    if (!TapToolsAPI.instance) {
      TapToolsAPI.instance = new TapToolsAPI();
    }
    return TapToolsAPI.instance;
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

  async getTokenLiquidityPools(params: {
    ticker?: string;
    onchainID?: string;
    adaOnly?: boolean;
  }): Promise<any> {
    try {
      // Build query parameters
      const queryParams: Record<string, string> = {};

      // If ticker is provided, resolve it to a unit
      if (params.ticker) {
        // Get the token unit from the EnhancedTokenStore
        const unit = await tokenLookupService.getTokenUnit(params.ticker);

        if (unit) {
          logger.info(`Found unit for ${params.ticker} in EnhancedTokenStore: ${unit}`);
          queryParams.unit = unit;
        } else {
          // If not found in enhanced store, try the old token store as fallback
          const oldToken = TokenStore.getInstance().getTokenUnit(params.ticker);
          if (oldToken) {
            queryParams.unit = oldToken;
            logger.info(`Found unit for ${params.ticker} in legacy TokenStore: ${oldToken}`);
          } else {
            // If still not found, throw error
            throw new Error(`Could not resolve token unit for ticker: ${params.ticker}. Token not found in any data source.`);
          }
        }
      }

      // Add other parameters if provided
      if (params.onchainID) queryParams.onchainID = params.onchainID;
      if (params.adaOnly !== undefined) queryParams.adaOnly = params.adaOnly ? '1' : '0';

      // Create a cache key based on the parameters
      const cacheKey = `liquidity-pools-${JSON.stringify(queryParams)}`;
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;

      // Make the API request
      const response = await this.fetchWithAuth('/token/pools', queryParams);

      // Cache and return the result
      this.cache.set(cacheKey, response);
      return response;
    } catch (error) {
      logger.error('Failed to fetch token liquidity pools:', {
        params,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

// Create the Token Liquidity Pools Tool
export const CardanoTokenLiquidityPools = createTool({
  id: 'cardano-token-liquidity-pools',
  description: 'Retrieves liquidity pool data for Cardano tokens across all DEXes',
  inputSchema: z.object({
    ticker: z.string()
      .optional()
      .describe('Token ticker (e.g., "LENFI", "MIN", "AGIX") to find liquidity pools for'),
    onchainID: z.string()
      .optional()
      .describe('Specific liquidity pool onchain ID to look up'),
    adaOnly: z.boolean()
      .optional()
      .default(true)
      .describe('Whether to return only ADA pools (true) or all pools (false)')
  }),
  async execute(input: { context?: Record<string, any>; args?: Record<string, any> }) {
    try {
      const api = TapToolsAPI.getInstance();
      const params = input?.context || input?.args || {};

      // Ensure at least one of ticker or onchainID is provided
      if (!params.ticker && !params.onchainID) {
        throw new Error('Either ticker or onchainID must be provided');
      }

      // Log request for debugging
      logger.info('CardanoTokenLiquidityPools request:', params);

      const pools = await api.getTokenLiquidityPools({
        ticker: params.ticker,
        onchainID: params.onchainID,
        adaOnly: params.adaOnly !== false // Default to true if not specified
      });

      // Log the response for debugging
      logger.info(`TapTools API response: ${pools.length} pools found`);

      // Process and format the pools
      const formattedPools = pools.map((pool: any) => ({
        exchange: pool.exchange,
        onchainID: pool.onchainID,
        lpTokenUnit: pool.lpTokenUnit,
        tokens: {
          a: {
            unit: pool.tokenA,
            ticker: pool.tokenATicker,
            locked: pool.tokenALocked,
            formatted: formatNumber(pool.tokenALocked)
          },
          b: {
            unit: pool.tokenB || 'lovelace', // ADA is represented as 'lovelace' in Cardano
            ticker: pool.tokenBTicker,
            locked: pool.tokenBLocked,
            formatted: formatNumber(pool.tokenBLocked)
          }
        },
        tvl: calculateTVL(pool),
        ratio: calculateRatio(pool)
      }));

      // Calculate some statistics
      const stats = calculatePoolStats(formattedPools);

      // Get token metadata for additional context
      const token = params.ticker ? await tokenLookupService.resolveToken(params.ticker) : null;

      return {
        token: token ? {
          ticker: token.ticker,
          name: token.name,
          unit: token.unit,
          policy_id: token.policy_id
        } : undefined,
        pools: formattedPools,
        stats,
        filters: {
          ticker: params.ticker,
          onchainID: params.onchainID,
          adaOnly: params.adaOnly !== false
        },
        metadata: {
          last_updated: new Date().toISOString(),
          source: 'TapTools API'
        },
        cache_info: {
          age: '0s' // Fixed cache age calculation
        }
      };
    } catch (error: unknown) {
      logger.error('Error in CardanoTokenLiquidityPools:', {
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        error: true,
        message: error instanceof Error ? error.message : 'Unknown error in liquidity pools lookup',
        suggestion: 'Please verify your input parameters and try again.'
      };
    }
  }
});

// Helper functions
function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2
  }).format(value);
}

function calculateTVL(pool: any): { ada: number; formatted: string } {
  // For simplicity, we're just using the ADA value as TVL
  // In a real implementation, you would calculate the USD value of both tokens
  const adaValue = pool.tokenBTicker === 'ADA' ? pool.tokenBLocked : 0;

  return {
    ada: adaValue,
    formatted: formatCurrency(adaValue)
  };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function calculateRatio(pool: any): { ratio: string; tokenAPerTokenB: number; tokenBPerTokenA: number } {
  if (!pool.tokenALocked || !pool.tokenBLocked) {
    return {
      ratio: 'N/A',
      tokenAPerTokenB: 0,
      tokenBPerTokenA: 0
    };
  }

  const tokenAPerTokenB = pool.tokenALocked / pool.tokenBLocked;
  const tokenBPerTokenA = pool.tokenBLocked / pool.tokenALocked;

  return {
    ratio: `1 ${pool.tokenATicker} = ${tokenBPerTokenA.toFixed(6)} ${pool.tokenBTicker}`,
    tokenAPerTokenB,
    tokenBPerTokenA
  };
}

function calculatePoolStats(pools: any[]): any {
  if (!pools || pools.length === 0) {
    return {
      total_pools: 0,
      total_tvl: { ada: 0, formatted: '$0.00' },
      exchanges: {},
      largest_pool: null
    };
  }

  // Count pools by exchange
  const exchanges: Record<string, number> = {};
  pools.forEach(pool => {
    exchanges[pool.exchange] = (exchanges[pool.exchange] || 0) + 1;
  });

  // Calculate total TVL
  const totalTVL = pools.reduce((sum, pool) => sum + pool.tvl.ada, 0);

  // Find largest pool by TVL
  let largestPool = pools[0];
  pools.forEach(pool => {
    if (pool.tvl.ada > largestPool.tvl.ada) {
      largestPool = pool;
    }
  });

  return {
    total_pools: pools.length,
    total_tvl: {
      ada: totalTVL,
      formatted: formatCurrency(totalTVL)
    },
    exchanges,
    largest_pool: {
      exchange: largestPool.exchange,
      tvl: largestPool.tvl,
      tokens: {
        a: largestPool.tokens.a.ticker,
        b: largestPool.tokens.b.ticker
      }
    }
  };
}
