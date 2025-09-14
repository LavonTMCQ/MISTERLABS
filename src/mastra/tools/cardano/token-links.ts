import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Simple logger implementation
const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] ${message}`, data || ''),
  error: (message: string, data?: any) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message: string, data?: any) => console.warn(`[WARN] ${message}`, data || ''),
  debug: (message: string, data?: any) => console.debug(`[DEBUG] ${message}`, data || '')
};

// Token Registry implementation using hardcoded token data
class TokenRegistry {
  private static instance: TokenRegistry;
  private tokensMap: Map<string, any> = new Map();

  private constructor() {
    // Hardcoded token data with common tokens
    const commonTokens = [
      {
        symbol: "ADA",
        name: "Cardano",
        policyId: "lovelace",
        unit: "lovelace"
      },
      {
        symbol: "MISTER",
        name: "MISTER",
        policyId: "7529bed52d81a20e69c6dd447dd9cc0293daf4577f08d7ed2d8ab081",
        unit: "7529bed52d81a20e69c6dd447dd9cc0293daf4577f08d7ed2d8ab0814d4953544552"
      },
      {
        symbol: "SNEK",
        name: "Snek",
        policyId: "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f",
        unit: "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b"
      },
      {
        symbol: "MIN",
        name: "MIN",
        policyId: "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6",
        unit: "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e"
      },
      {
        symbol: "WMT",
        name: "World Mobile Token",
        policyId: "1d7f33bd23d85e1a25d87d86fac4f199c3197a2f7afeb662a0f34e1e",
        unit: "1d7f33bd23d85e1a25d87d86fac4f199c3197a2f7afeb662a0f34e1e776f726c644d6f62696c65546f6b656e"
      },
      {
        symbol: "CHAD",
        name: "Chad",
        policyId: "5b34c6b3e76a6366c848933f5a44bf2a23ad27a05b55109c5a4b111e",
        unit: "5b34c6b3e76a6366c848933f5a44bf2a23ad27a05b55109c5a4b111e43484144",
        metadata: {
          social: {
            twitter: "https://twitter.com/charles_thechad"
          }
        }
      }
    ];

    // Create a map for quick lookups by ticker
    commonTokens.forEach(token => {
      const upperSymbol = token.symbol.toUpperCase();
      this.tokensMap.set(upperSymbol, token);
    });

    logger.info(`Loaded ${this.tokensMap.size} tokens into registry`);
  }

  static getInstance(): TokenRegistry {
    if (!TokenRegistry.instance) {
      TokenRegistry.instance = new TokenRegistry();
    }
    return TokenRegistry.instance;
  }

  async resolveToken(ticker: string): Promise<any | null> {
    const upperTicker = ticker.toUpperCase();
    return this.tokensMap.get(upperTicker) || null;
  }

  async getTokenUnit(ticker: string): Promise<string | null> {
    const token = await this.resolveToken(ticker);
    return token?.unit || null;
  }
}

const TAPTOOLS_API_KEY = process.env.TAPTOOLS_API_KEY || "jRYEk7JdYhTflTdGbpjD9aegTpCMwzq2";
const TAPTOOLS_BASE_URL = "https://openapi.taptools.io/api/v1";

// Cache implementation
class TokenLinksCache {
  private static instance: TokenLinksCache;
  private cache: Map<string, { data: any; timestamp: number }>;
  private readonly TTL = 3600000; // 1 hour cache for links

  private constructor() {
    this.cache = new Map();
  }

  static getInstance(): TokenLinksCache {
    if (!TokenLinksCache.instance) {
      TokenLinksCache.instance = new TokenLinksCache();
    }
    return TokenLinksCache.instance;
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
  private cache: TokenLinksCache;

  private constructor() {
    this.cache = TokenLinksCache.getInstance();
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

  async getTokenLinks(ticker: string): Promise<any> {
    try {
      const tokenRegistry = TokenRegistry.getInstance();
      
      // Get the token unit from the registry
      let unit = await tokenRegistry.getTokenUnit(ticker);

      // Special case for WOLF/MOFU token
      if ((ticker.toUpperCase() === 'WOLF' || ticker.toUpperCase() === 'MOFU') && !unit) {
        const wolfPolicyId = 'a2cdc9c73c59d668d5ae2c4dcd51447767362e8a325eaedc320c58f4';
        const wolfAssetName = '4d4f4f4e46555259'; // MOONFURY in hex
        unit = wolfPolicyId + wolfAssetName;
        logger.info(`Special case: Using hardcoded unit for ${ticker}: ${unit}`);
      }

      // If we still don't have a unit, try to resolve it using the database/TapTools
      if (!unit) {
        logger.info(`Token ${ticker} not in registry, attempting to resolve unit...`);
        try {
          // First try ticker-to-unit tool (database)
          const mod: any = await import('./ticker-to-unit');
          const resolveResult: any = await (mod.tickerToUnitTool as any).execute({
            context: { ticker: ticker, searchLimit: 10 },
            runtimeContext: new (await import('@mastra/core/runtime-context')).RuntimeContext(),
          });
          
          if (resolveResult?.success && resolveResult.data?.unit) {
            unit = resolveResult.data.unit as string;
            logger.info(`Successfully resolved ${ticker} to unit: ${unit}`);
          } else {
            // Database didn't have it, try comprehensive search
            logger.info(`Database lookup failed for ${ticker}, trying comprehensive search...`);
            const mod2: any = await import('./comprehensive-token-search');
            const searchResult: any = await (mod2.comprehensiveTokenSearchTool as any).execute({
              context: { query: ticker, maxResults: 1 },
              runtimeContext: new (await import('@mastra/core/runtime-context')).RuntimeContext(),
            });
            
            if (searchResult?.success && (searchResult.data?.tokens?.length > 0 || searchResult.data?.results?.length > 0)) {
              // Handle both possible return formats
              const token = searchResult.data.tokens?.[0] || searchResult.data.results?.[0];
              unit = token.unit || (token.policyId || token.policy_id) + (token.assetName || token.asset_name || '');
              logger.info(`Found ${ticker} via comprehensive search: ${unit}`);
            } else {
              throw new Error(`Could not find token ${ticker} in database or TapTools API`);
            }
          }
        } catch (resolveError) {
          logger.error(`Failed to resolve unit for ${ticker}:`, resolveError);
          throw new Error(`Could not resolve token unit for ticker: ${ticker}`);
        }
      }

      // Ensure unit is resolved before API request
      if (!unit) {
        throw new Error(`Could not resolve token unit for ticker: ${ticker}`);
      }

      // Now make the API request with the unit we found
      const cacheKey = `links-${unit}`;
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;

      try {
        const response = await this.fetchWithAuth('/token/links', { unit });
        // Cache and return the result
        this.cache.set(cacheKey, response);
        return response;
      } catch (apiError) {
        // Handle 404 errors gracefully - token not indexed in TapTools
        if (apiError instanceof Error && apiError.message.includes('404')) {
          logger.warn(`Token ${ticker} not found in TapTools API, returning empty links`);
          const fallbackResponse = {
            website: null,
            whitepaper: null,
            documentation: null,
            twitter: null,
            telegram: null,
            discord: null,
            github: null,
            medium: null,
            reddit: null,
            taptools: null,
            minswap: null,
            sundaeswap: null,
            muesliswap: null,
            explorers: []
          };
          this.cache.set(cacheKey, fallbackResponse);
          return fallbackResponse;
        }
        // Re-throw other errors
        throw apiError;
      }
    } catch (error) {
      logger.error('Failed to fetch token links:', {
        ticker,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

// Create the Token Links Tool
export const CardanoTokenLinks = createTool({
  id: 'cardano-token-links',
  description: 'Retrieves comprehensive social and project links for a Cardano token using its ticker symbol',
  inputSchema: z.object({
    ticker: z.string()
      .describe('Token ticker (e.g., "LENFI", "MIN", "AGIX")')
  }),
  async execute(input: { context?: Record<string, any>; args?: Record<string, any> }) {
    try {
      const api = TapToolsAPI.getInstance();
      const tokenRegistry = TokenRegistry.getInstance();
      const params = input?.context || input?.args || {};

      if (!params.ticker) {
        throw new Error('Invalid input: ticker is required');
      }

      // Log request for debugging
      logger.info('CardanoTokenLinks request:', {
        ticker: params.ticker
      });

      const links = await api.getTokenLinks(params.ticker);
      const token = await tokenRegistry.resolveToken(params.ticker);

      // Merge TapTools links with TokenRegistry metadata
      const mergedLinks = {
        official: {
          website: links.website || token?.metadata?.website,
          whitepaper: links.whitepaper,
          documentation: links.documentation
        },
        social: {
          twitter: links.twitter || token?.metadata?.social?.twitter,
          telegram: links.telegram || token?.metadata?.social?.telegram,
          discord: links.discord || token?.metadata?.social?.discord,
          github: links.github || token?.metadata?.social?.github,
          medium: links.medium || token?.metadata?.social?.medium,
          reddit: links.reddit || token?.metadata?.social?.reddit
        },
        markets: {
          taptools: links.taptools,
          minswap: links.minswap,
          sundaeswap: links.sundaeswap,
          muesliswap: links.muesliswap
        },
        explorers: links.explorers || []
      };

      return {
        success: true,
        tokens: [
          {
            ticker: params.ticker,
            name: token?.name || 'Unknown',
            unit: token?.unit || 'Unknown',
            policy_id: token?.policyId || '',
            social: mergedLinks.social,
            official: mergedLinks.official
          }
        ],
        token: {
          ticker: params.ticker,
          name: token?.name || 'Unknown',
          unit: token?.unit || 'Unknown',
          policy_id: token?.policyId || ''
        },
        links: mergedLinks,
        metadata: {
          sources: ['TapTools API', 'Token Registry'],
          last_updated: new Date().toISOString()
        },
        cache_info: {
          age: Math.round((Date.now() - (TokenLinksCache.getInstance().get(`links-${token?.unit}`)?.timestamp || 0)) / 1000) + 's'
        }
      };
    } catch (error: unknown) {
      logger.error('Error in CardanoTokenLinks:', {
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        error: true,
        message: error instanceof Error ? error.message : 'Unknown error in token links lookup',
        suggestion: 'Please verify your input ticker and try again.'
      };
    }
  }
});
