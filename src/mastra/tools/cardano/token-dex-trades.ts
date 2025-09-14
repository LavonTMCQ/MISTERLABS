import { createTool } from '@mastra/core';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

// Create a simple logger
const logger = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
  debug: (...args: any[]) => console.debug('[DEBUG]', ...args)
};

// Import the EnhancedTokenStore
import { tokenLookupService } from '../../services/token-lookup';

const TAPTOOLS_API_KEY = process.env.TAPTOOLS_API_KEY || "WghkJaZlDWYdQFsyt3uiLdTIOYnR5uhO";
const TAPTOOLS_BASE_URL = "https://openapi.taptools.io/api/v1";

// Cache implementation
class DexTradesCache {
  private static instance: DexTradesCache;
  private cache: Map<string, { data: any; timestamp: number }>;
  private readonly TTL = 300000; // 5 minutes cache

  private constructor() {
    this.cache = new Map();
  }

  static getInstance(): DexTradesCache {
    if (!DexTradesCache.instance) {
      DexTradesCache.instance = new DexTradesCache();
    }
    return DexTradesCache.instance;
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
  private cache: DexTradesCache;

  private constructor() {
    this.cache = DexTradesCache.getInstance();
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

  async getTokenDexTrades(params: {
    ticker?: string;
    timeframe?: string;
    sortBy?: string;
    order?: string;
    minAmount?: number;
    from?: number;
    page?: number;
    perPage?: number;
  }): Promise<any> {
    try {
      // Build query parameters
      const queryParams: Record<string, string> = {};

      // If ticker is provided, resolve it to a unit using EnhancedTokenStore
      if (params.ticker) {
        const tokenData = await tokenLookupService.resolveToken(params.ticker);
        const unit = tokenData?.unit;
        if (unit) {
          logger.info(`Found unit for ${params.ticker} in EnhancedTokenStore: ${unit}`);
          queryParams.unit = unit;
        } else {
          throw new Error(`Could not resolve token unit for ticker: ${params.ticker}. Make sure it exists in the token store.`);
        }
      }

      // Add other parameters if provided
      if (params.timeframe) queryParams.timeframe = params.timeframe;
      if (params.sortBy) queryParams.sortBy = params.sortBy;
      if (params.order) queryParams.order = params.order;
      if (params.minAmount) queryParams.minAmount = params.minAmount.toString();
      if (params.from) queryParams.from = params.from.toString();
      if (params.page) queryParams.page = params.page.toString();
      if (params.perPage) queryParams.perPage = params.perPage.toString();

      // Create a cache key based on the parameters
      const cacheKey = `dex-trades-${JSON.stringify(queryParams)}`;
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;

      // Make the API request
      const response = await this.fetchWithAuth('/token/trades', queryParams);

      // Cache and return the result
      this.cache.set(cacheKey, response);
      return response;
    } catch (error) {
      logger.error('Failed to fetch token DEX trades:', {
        params,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

// Create the Token DEX Trades Tool
export const CardanoTokenDexTrades = createTool({
  id: 'cardano-token-dex-trades',
  description: 'Retrieves DEX trade data for Cardano tokens across all DEXes',
  inputSchema: z.object({
    ticker: z.string()
      .optional()
      .describe('Token ticker (e.g., "LENFI", "MIN", "AGIX") to filter trades for a specific token'),
    timeframe: z.enum(['1h', '4h', '24h', '7d', '30d', '90d', '180d', '1y', 'all'])
      .default('30d')
      .describe('Timeframe for filtering trades (default: 30d)'),
    sortBy: z.enum(['amount', 'time'])
      .default('amount')
      .describe('Sort trades by amount or time (default: amount)'),
    order: z.enum(['asc', 'desc'])
      .default('desc')
      .describe('Sort order (default: desc)'),
    minAmount: z.number()
      .optional()
      .describe('Minimum ADA amount to filter trades'),
    page: z.number()
      .min(1)
      .default(1)
      .describe('Page number for pagination (default: 1)'),
    perPage: z.number()
      .min(1)
      .max(100)
      .default(10)
      .describe('Number of trades per page (default: 10, max: 100)')
  }),
  async execute(input: { context?: Record<string, any>; args?: Record<string, any> }) {
    try {
      const api = TapToolsAPI.getInstance();
      const params = input?.context || input?.args || {};

      // Log request for debugging
      logger.info('CardanoTokenDexTrades request:', params);

      const trades = await api.getTokenDexTrades({
        ticker: params.ticker,
        timeframe: params.timeframe || '30d',
        sortBy: params.sortBy || 'amount',
        order: params.order || 'desc',
        minAmount: params.minAmount,
        page: params.page || 1,
        perPage: params.perPage || 10
      });

      // Log the response for debugging
      logger.info(`TapTools API response: ${trades.length} trades found`);

      // Process and format the trades
      const formattedTrades = trades.map((trade: any) => ({
        action: trade.action,
        exchange: trade.exchange,
        hash: trade.hash,
        time: {
          timestamp: trade.time,
          formatted: formatTimestamp(trade.time)
        },
        tokens: {
          a: {
            unit: trade.tokenA,
            name: trade.tokenAName,
            amount: trade.tokenAAmount
          },
          b: {
            unit: trade.tokenB,
            name: trade.tokenBName,
            amount: trade.tokenBAmount
          }
        },
        price: trade.price,
        address: shortenAddress(trade.address)
      }));

      // Calculate some statistics
      const stats = calculateTradeStats(trades);

      return {
        trades: formattedTrades,
        stats,
        pagination: {
          page: params.page || 1,
          perPage: params.perPage || 10,
          total_items: formattedTrades.length,
          has_more: formattedTrades.length === (params.perPage || 10)
        },
        filters: {
          ticker: params.ticker,
          timeframe: params.timeframe || '30d',
          sortBy: params.sortBy || 'amount',
          order: params.order || 'desc',
          minAmount: params.minAmount
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
      logger.error('Error in CardanoTokenDexTrades:', {
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        error: true,
        message: error instanceof Error ? error.message : 'Unknown error in DEX trades lookup',
        suggestion: 'Please verify your input parameters and try again.'
      };
    }
  }
});

// Helper functions
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

function shortenAddress(address: string): string {
  if (!address) return '';
  return `${address.substring(0, 10)}...${address.substring(address.length - 10)}`;
}

function calculateTradeStats(trades: any[]): any {
  if (!trades || trades.length === 0) {
    return {
      total_trades: 0,
      buy_trades: 0,
      sell_trades: 0,
      exchanges: {},
      largest_trade: null,
      average_trade_size: 0
    };
  }

  // Count buys and sells
  const buyTrades = trades.filter(t => t.action === 'buy').length;
  const sellTrades = trades.filter(t => t.action === 'sell').length;

  // Count trades by exchange
  const exchanges: Record<string, number> = {};
  trades.forEach(trade => {
    exchanges[trade.exchange] = (exchanges[trade.exchange] || 0) + 1;
  });

  // Find largest trade by ADA amount
  let largestTrade = trades[0];
  trades.forEach(trade => {
    const currentAmount = trade.tokenBName === 'ADA' ? trade.tokenBAmount : 0;
    const largestAmount = largestTrade.tokenBName === 'ADA' ? largestTrade.tokenBAmount : 0;
    if (currentAmount > largestAmount) {
      largestTrade = trade;
    }
  });

  // Calculate average trade size (for ADA trades only)
  const adaTrades = trades.filter(t => t.tokenBName === 'ADA');
  const totalAdaVolume = adaTrades.reduce((sum, trade) => sum + trade.tokenBAmount, 0);
  const averageTradeSize = adaTrades.length > 0 ? totalAdaVolume / adaTrades.length : 0;

  return {
    total_trades: trades.length,
    buy_trades: buyTrades,
    sell_trades: sellTrades,
    buy_percentage: ((buyTrades / trades.length) * 100).toFixed(2) + '%',
    sell_percentage: ((sellTrades / trades.length) * 100).toFixed(2) + '%',
    exchanges,
    largest_trade: largestTrade ? {
      action: largestTrade.action,
      exchange: largestTrade.exchange,
      amount: largestTrade.tokenBName === 'ADA' ? largestTrade.tokenBAmount : 0,
      time: formatTimestamp(largestTrade.time)
    } : null,
    average_trade_size: averageTradeSize
  };
}
