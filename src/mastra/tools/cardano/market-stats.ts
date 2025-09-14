import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Simple logger implementation
const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] ${message}`, data || ''),
  error: (message: string, data?: any) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message: string, data?: any) => console.warn(`[WARN] ${message}`, data || ''),
  debug: (message: string, data?: any) => console.debug(`[DEBUG] ${message}`, data || '')
};

const TAPTOOLS_API_KEY = process.env.TAPTOOLS_API_KEY || "WghkJaZlDWYdQFsyt3uiLdTIOYnR5uhO";
const TAPTOOLS_BASE_URL = "https://openapi.taptools.io/api/v1";

// Cache implementation for market stats
class MarketStatsCache {
  private static instance: MarketStatsCache;
  private cache: Map<string, { data: any; timestamp: number }>;
  private readonly TTL = 300000; // 5 minutes cache

  private constructor() {
    this.cache = new Map();
  }

  static getInstance(): MarketStatsCache {
    if (!MarketStatsCache.instance) {
      MarketStatsCache.instance = new MarketStatsCache();
    }
    return MarketStatsCache.instance;
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
}

// API Client for Market Stats
class TapToolsMarketStatsAPI {
  private static instance: TapToolsMarketStatsAPI;
  private cache: MarketStatsCache;

  private constructor() {
    this.cache = MarketStatsCache.getInstance();
  }

  static getInstance(): TapToolsMarketStatsAPI {
    if (!TapToolsMarketStatsAPI.instance) {
      TapToolsMarketStatsAPI.instance = new TapToolsMarketStatsAPI();
    }
    return TapToolsMarketStatsAPI.instance;
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

  async getMarketStats(quote: string = 'ADA'): Promise<any> {
    const params: Record<string, string> = {};
    if (quote && quote !== 'ADA') {
      params.quote = quote;
    }

    // Create cache key
    const cacheKey = `market-stats-${quote}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    try {
      logger.info('Fetching Cardano market stats:', { quote });

      const data = await this.fetchWithAuth('/market/stats', params);
      this.cache.set(cacheKey, data);
      return data;
    } catch (error) {
      logger.error('Failed to fetch market stats:', {
        quote,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

// Create the Market Stats Tool
export const CardanoMarketStats = createTool({
  id: 'cardano-market-stats',
  description: 'Get aggregated Cardano ecosystem market statistics including 24h DEX volume and total active addresses onchain. Active addresses are addresses that have either sent or received any transactions within the last 24 hours. Use this tool when users ask for daily market info, ecosystem activity, or general Cardano market overview. Note: ADA is the primary supported quote currency.',
  inputSchema: z.object({
    quote: z.enum(['ADA', 'USD', 'EUR', 'ETH', 'BTC'])
      .optional()
      .default('ADA')
      .describe('Quote currency to use for volume data (default: ADA, other currencies may not have data available)')
  }),
  async execute(input: { context?: Record<string, any>; args?: Record<string, any> }) {
    try {
      const api = TapToolsMarketStatsAPI.getInstance();
      const params = input?.context || input?.args || {};

      // Apply defaults if parameters are missing
      const quote = params.quote || 'ADA';

      logger.info('CardanoMarketStats request:', { quote });

      const marketStats = await api.getMarketStats(quote);

      // Handle null values from API (some quote currencies may not be supported)
      const activeAddresses = marketStats.activeAddresses || 0;
      const dexVolume = marketStats.dexVolume || 0;

      // Check if data is available
      const hasValidData = marketStats.activeAddresses !== null && marketStats.dexVolume !== null;

      if (!hasValidData) {
        return {
          error: false,
          message: `Market stats not available for quote currency: ${quote}`,
          suggestion: 'Try using ADA as the quote currency instead.',
          available_quotes: ['ADA'],
          market_stats: {
            active_addresses: null,
            dex_volume_24h: null,
            quote_currency: quote,
            data_available: false
          }
        };
      }

      // Format the response with additional context
      return {
        market_stats: {
          active_addresses: activeAddresses,
          dex_volume_24h: dexVolume,
          quote_currency: quote,
          data_available: true
        },
        insights: {
          activity_level: activeAddresses > 20000 ? 'High' :
                         activeAddresses > 15000 ? 'Medium' : 'Low',
          volume_description: `${dexVolume.toLocaleString()} ${quote} in 24h DEX volume`,
          addresses_description: `${activeAddresses.toLocaleString()} active addresses in the last 24 hours`
        },
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'TapTools API',
          quote_currency: quote
        },
        cache_info: {
          age: Math.round((Date.now() - (MarketStatsCache.getInstance().get(`market-stats-${quote}`)?.timestamp || 0)) / 1000) + 's'
        }
      };
    } catch (error) {
      logger.error('Error in CardanoMarketStats:', {
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        error: true,
        message: error instanceof Error ? error.message : 'Unknown error fetching market stats',
        suggestion: 'Please try again or check if the TapTools API is accessible.'
      };
    }
  }
});