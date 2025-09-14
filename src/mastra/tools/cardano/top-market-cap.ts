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
class TopMarketCapCache {
  private static instance: TopMarketCapCache;
  private cache: Map<string, { data: any; timestamp: number }>;
  private readonly TTL = 300000; // 5 minutes cache

  private constructor() {
    this.cache = new Map();
  }

  static getInstance(): TopMarketCapCache {
    if (!TopMarketCapCache.instance) {
      TopMarketCapCache.instance = new TopMarketCapCache();
    }
    return TopMarketCapCache.instance;
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
  private cache: TopMarketCapCache;

  private constructor() {
    this.cache = TopMarketCapCache.getInstance();
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

  async getTopMarketCap(type: string = 'mcap', page: number = 1, perPage: number = 100): Promise<any> {
    const params: Record<string, string> = {
      type,
      page: page.toString(),
      perPage: perPage.toString()
    };

    // Create cache key
    const cacheKey = `top-mcap-${type}-${page}-${perPage}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    try {
      // Log request for debugging
      logger.info('Fetching top market cap tokens:', {
        type,
        page,
        perPage
      });

      const data = await this.fetchWithAuth('/token/top/mcap', params);
      this.cache.set(cacheKey, data);
      return data;
    } catch (error) {
      logger.error('Failed to fetch top market cap tokens:', {
        type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

// Create the Top Market Cap Tool
export const CardanoTopMarketCap = createTool({
  id: 'cardano-top-marketcap',
  description: 'Retrieves top market cap tokens on Cardano. Use this for general market overviews, token rankings by market cap, and identifying the largest tokens in the Cardano ecosystem. Can filter out stablecoins for clearer market analysis.',
  inputSchema: z.object({
    type: z.enum(['mcap', 'fdv'])
      .optional()
      .default('mcap')
      .describe('Sort by circulating market cap (default) or fully diluted value'),
    page: z.number()
      .min(1)
      .optional()
      .default(1)
      .describe('Page number for pagination (default: 1)'),
    perPage: z.number()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe('Number of results per page (default: 20, max: 100)'),
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
      const type = params.type || 'mcap';
      const page = params.page || 1;
      const perPage = params.perPage || 20;
      const filterStablecoins = params.filterStablecoins !== undefined ? params.filterStablecoins : false;

      // Log request for debugging
      logger.info('CardanoTopMarketCap request:', {
        type,
        page,
        perPage,
        filterStablecoins
      });

      // Request more tokens if we're filtering to ensure we still have enough results
      const requestPerPage = filterStablecoins ? Math.min(100, perPage * 2) : perPage;

      const topMarketCap = await api.getTopMarketCap(
        type,
        page,
        requestPerPage
      );

      // Filter out stablecoins if requested
      let filteredTokens = topMarketCap;
      if (filterStablecoins) {
        filteredTokens = topMarketCap.filter((token: any) => !isStablecoin(token));
        // Adjust for pagination if we filtered
        filteredTokens = filteredTokens.slice(0, perPage);
      }

      return {
        tokens: filteredTokens.map((token: any, index: number) => ({
          rank: index + 1,
          ticker: token.ticker,
          unit: token.unit,
          price: token.price,
          circulating_supply: token.circSupply,
          total_supply: token.totalSupply,
          market_cap: token.mcap,
          fully_diluted_value: token.fdv
        })),
        metadata: {
          sort_by: type,
          pagination: {
            page,
            per_page: perPage
          },
          filters: {
            stablecoins_filtered: filterStablecoins
          }
        },
        cache_info: {
          age: Math.round((Date.now() - (TopMarketCapCache.getInstance().get(`top-mcap-${type}-${page}-${requestPerPage}`)?.timestamp || Date.now())) / 1000) + 's'
        }
      };
    } catch (error) {
      logger.error('Error in CardanoTopMarketCap:', {
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        error: true,
        message: error instanceof Error ? error.message : 'Unknown error in top market cap analysis',
        suggestion: 'Please try again or request a simpler market overview.'
      };
    }
  }
});