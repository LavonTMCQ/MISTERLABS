import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Simple logger implementation since the config/logging file is missing
const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] ${message}`, data || ''),
  error: (message: string, data?: any) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message: string, data?: any) => console.warn(`[WARN] ${message}`, data || ''),
  debug: (message: string, data?: any) => console.debug(`[DEBUG] ${message}`, data || '')
};

const TAPTOOLS_API_KEY = process.env.TAPTOOLS_API_KEY || "WghkJaZlDWYdQFsyt3uiLdTIOYnR5uhO";
const TAPTOOLS_BASE_URL = "https://openapi.taptools.io/api/v1";

// Known stablecoins in the Cardano ecosystem
const CARDANO_STABLECOINS = [
  'iUSD', 'DJED', 'USDM', 'USDA', 'USDC', 'USDT', 'BUSD', 'DAI', 'TUSD', 'DUSD',
  'XUSD', 'JUSD', 'IUSD', 'SUSD', 'NUSD'
].map(s => s.toLowerCase());

// Helper function to check if a token is a stablecoin
function isStablecoin(token: any): boolean {
  // Check against known stablecoin list
  if (CARDANO_STABLECOINS.includes(token.ticker.toLowerCase())) {
    return true;
  }

  // Common stablecoin naming patterns
  const stablecoinPatterns = [
    /^[a-z]*usd$/i,   // Ends with usd
    /^[a-z]*eur$/i,   // Ends with eur
    /^[a-z]*jpy$/i,   // Ends with jpy
    /^[a-z]*gbp$/i,   // Ends with gbp
    /^[a-z]*aud$/i,   // Ends with aud
    /^[a-z]*cad$/i,   // Ends with cad
    /^[a-z]*chf$/i,   // Ends with chf
    /stablecoin/i,    // Contains stablecoin
    /stable/i         // Contains stable
  ];

  return stablecoinPatterns.some(pattern => pattern.test(token.ticker));
}

// Cache implementation
class TopVolumeCache {
  private static instance: TopVolumeCache;
  private cache: Map<string, { data: any; timestamp: number }>;
  private readonly TTL = 300000; // 5 minutes cache

  private constructor() {
    this.cache = new Map();
  }

  static getInstance(): TopVolumeCache {
    if (!TopVolumeCache.instance) {
      TopVolumeCache.instance = new TopVolumeCache();
    }
    return TopVolumeCache.instance;
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

// API Client
class TapToolsAPI {
  private static instance: TapToolsAPI;
  private cache: TopVolumeCache;

  private constructor() {
    this.cache = TopVolumeCache.getInstance();
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

  async getTopVolume(timeframe: string = '24h', page: number = 1, perPage: number = 100): Promise<any> {
    const params: Record<string, string> = {
      timeframe,
      page: page.toString(),
      perPage: perPage.toString()
    };

    // Create cache key
    const cacheKey = `top-volume-${timeframe}-${page}-${perPage}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    try {
      // Log request for debugging
      logger.info('Fetching top volume tokens:', {
        timeframe,
        page,
        perPage
      });

      const data = await this.fetchWithAuth('/token/top/volume', params);
      this.cache.set(cacheKey, data);
      return data;
    } catch (error) {
      logger.error('Failed to fetch top volume tokens:', {
        timeframe,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

// Create the Top Volume Tool
export const CardanoTopVolume = createTool({
  id: 'cardano-top-volume',
  description: 'Retrieves top volume tokens on Cardano for a given timeframe. Use this for general market activity overviews, identifying trending tokens by trading volume, and analyzing which tokens are most actively traded. Can filter out stablecoins for clearer market analysis.',
  inputSchema: z.object({
    timeframe: z.enum(['1h', '4h', '12h', '24h', '7d', '30d', '180d', '1y', 'all'])
      .optional()
      .default('24h')
      .describe('Time period for volume data (default: 24h)'),
    page: z.number()
      .min(1)
      .optional()
      .default(1)
      .describe('Page number for pagination (default: 1)'),
    perPage: z.number()
      .min(1)
      .max(100)
      .optional()
      .default(50)
      .describe('Number of results per page (default: 50, max: 100)'),
    filterStablecoins: z.boolean()
      .optional()
      .default(false)
      .describe('Filter out stablecoins like iUSD, DJED, USDM from results (default: false)')
  }),
  async execute(input: { context?: Record<string, any>; args?: Record<string, any> }) {
    try {
      const api = TapToolsAPI.getInstance();
      const params = input?.context || input?.args || {};

      // Apply defaults if parameters are missing
      const timeframe = params.timeframe || '24h';
      const page = params.page || 1;
      const perPage = params.perPage || 50; // Default to 50 tokens per page
      const filterStablecoins = params.filterStablecoins !== undefined ? params.filterStablecoins : false;

      // Log request for debugging
      logger.info('CardanoTopVolume request:', {
        timeframe,
        page,
        perPage,
        filterStablecoins
      });

      // Request more tokens if we're filtering to ensure we still have enough results
      const requestPerPage = filterStablecoins ? Math.min(100, perPage * 2) : perPage;

      const topVolume = await api.getTopVolume(
        timeframe,
        page,
        requestPerPage
      );

      // Filter out stablecoins if requested
      let filteredTokens = topVolume;
      if (filterStablecoins) {
        filteredTokens = topVolume.filter((token: any) => !isStablecoin(token));
        // Adjust for pagination if we filtered
        filteredTokens = filteredTokens.slice(0, perPage);
      }

      // Calculate total volume for percentage calculations (based on filtered tokens)
      const totalVolume = filteredTokens.reduce((sum: number, token: any) => sum + token.volume, 0);

      return {
        tokens: filteredTokens.map((token: any, index: number) => ({
          rank: index + 1,
          ticker: token.ticker,
          unit: token.unit,
          price: token.price,
          volume: token.volume,
          volume_share: ((token.volume / totalVolume) * 100).toFixed(2) + '%'
        })),
        metadata: {
          timeframe,
          total_volume: totalVolume,
          pagination: {
            page,
            per_page: perPage
          },
          filters: {
            stablecoins_filtered: filterStablecoins
          }
        },
        cache_info: {
          age: Math.round((Date.now() - (TopVolumeCache.getInstance().get(`top-volume-${timeframe}-${page}-${requestPerPage}`)?.timestamp || 0)) / 1000) + 's'
        }
      };
    } catch (error) {
      logger.error('Error in CardanoTopVolume:', {
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        error: true,
        message: error instanceof Error ? error.message : 'Unknown error in top volume analysis',
        suggestion: 'Please try again or request a simpler market overview.'
      };
    }
  }
});