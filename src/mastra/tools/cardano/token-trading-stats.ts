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
class TradingStatsCache {
  private static instance: TradingStatsCache;
  private cache: Map<string, { data: any; timestamp: number }>;
  private readonly TTL = 300000; // 5 minutes cache

  private constructor() {
    this.cache = new Map();
  }

  static getInstance(): TradingStatsCache {
    if (!TradingStatsCache.instance) {
      TradingStatsCache.instance = new TradingStatsCache();
    }
    return TradingStatsCache.instance;
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
  private cache: TradingStatsCache;

  private constructor() {
    this.cache = TradingStatsCache.getInstance();
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

  async getTokenTradingStats(ticker: string, timeframe: string = '24h'): Promise<any> {
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
      const cacheKey = `trading-stats-${unit}-${timeframe}`;
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;

      const response = await this.fetchWithAuth('/token/trading/stats', {
        unit,
        timeframe
      });

      // Cache and return the result
      this.cache.set(cacheKey, response);
      return response;
    } catch (error) {
      logger.error('Failed to fetch token trading stats:', {
        ticker,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

// Create the Token Trading Stats Tool
export const CardanoTokenTradingStats = createTool({
  id: 'cardano-token-trading-stats',
  description: 'Retrieves trading statistics for a specific Cardano token using its ticker symbol',
  inputSchema: z.object({
    ticker: z.string()
      .describe('Token ticker (e.g., "LENFI", "MIN", "AGIX")'),
    timeframe: z.enum(['15m', '1h', '4h', '12h', '24h', '7d', '30d', '90d', '180d', '1y', 'all'])
      .default('24h')
      .describe('Timeframe for aggregating trading data (default: 24h)')
  }),
  async execute(input: { context?: Record<string, any>; args?: Record<string, any> }) {
    try {
      const api = TapToolsAPI.getInstance();
      const params = input?.context || input?.args || {};

      if (!params.ticker) {
        throw new Error('Invalid input: ticker is required');
      }

      // Log request for debugging
      logger.info('CardanoTokenTradingStats request:', {
        ticker: params.ticker,
        timeframe: params.timeframe || '24h'
      });

      const tradingStats = await api.getTokenTradingStats(
        params.ticker,
        params.timeframe || '24h'
      );

      // Log the response for debugging
      logger.info('TapTools API response:', JSON.stringify(tradingStats));

      // Get token metadata for additional context
      const token = await tokenLookupService.resolveToken(params.ticker);

      // Format the trading stats for better readability
      const formattedStats = {
        token: {
          ticker: params.ticker,
          name: token?.name || 'Unknown',
          unit: token?.unit || 'Unknown',
          policy_id: token?.policy_id
        },
        timeframe: params.timeframe || '24h',
        volume: {
          buy: tradingStats.buyVolume || 0,
          sell: tradingStats.sellVolume || 0,
          total: (tradingStats.buyVolume || 0) + (tradingStats.sellVolume || 0),
          formatted: {
            buy: formatCurrency(tradingStats.buyVolume || 0),
            sell: formatCurrency(tradingStats.sellVolume || 0),
            total: formatCurrency((tradingStats.buyVolume || 0) + (tradingStats.sellVolume || 0))
          }
        },
        trades: {
          buys: tradingStats.buys || 0,
          sells: tradingStats.sells || 0,
          total: (tradingStats.buys || 0) + (tradingStats.sells || 0),
          buy_percentage: calculatePercentage(tradingStats.buys, (tradingStats.buys || 0) + (tradingStats.sells || 0)),
          sell_percentage: calculatePercentage(tradingStats.sells, (tradingStats.buys || 0) + (tradingStats.sells || 0))
        },
        participants: {
          buyers: tradingStats.buyers || 0,
          sellers: tradingStats.sellers || 0,
          total: (tradingStats.buyers || 0) + (tradingStats.sellers || 0),
          unique: Math.min((tradingStats.buyers || 0) + (tradingStats.sellers || 0), Math.max(tradingStats.buyers || 0, tradingStats.sellers || 0) * 1.5)
        },
        buy_sell_ratio: {
          volume: calculateRatio(tradingStats.buyVolume, tradingStats.sellVolume),
          trades: calculateRatio(tradingStats.buys, tradingStats.sells),
          sentiment: calculateSentiment(tradingStats.buys, tradingStats.sells)
        },
        metadata: {
          last_updated: new Date().toISOString(),
          source: 'TapTools API'
        },
        cache_info: {
          age: '0s' // Fixed cache age calculation
        }
      };

      return formattedStats;
    } catch (error: unknown) {
      logger.error('Error in CardanoTokenTradingStats:', {
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        error: true,
        message: error instanceof Error ? error.message : 'Unknown error in trading stats lookup',
        suggestion: 'Please verify your input ticker and try again.'
      };
    }
  }
});

// Helper functions for formatting data
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function calculatePercentage(part: number, total: number): string {
  if (!total) return '0.00%';
  return ((part / total) * 100).toFixed(2) + '%';
}

function calculateRatio(a: number, b: number): string {
  if (!b) return a ? 'Infinity' : 'N/A';
  const ratio = a / b;
  return ratio.toFixed(2);
}

function calculateSentiment(buys: number, sells: number): string {
  if (!buys && !sells) return 'Neutral';

  const ratio = buys / (sells || 1);

  if (ratio > 1.5) return 'Very Bullish';
  if (ratio > 1.1) return 'Bullish';
  if (ratio > 0.9) return 'Neutral';
  if (ratio > 0.5) return 'Bearish';
  return 'Very Bearish';
}
