import { z } from 'zod';
import { createTool } from "@mastra/core/tools";

const CMC_API_KEY = process.env.CMC_API_KEY || process.env.COINMARKETCAP_API_KEY || '';
const CMC_BASE_URL = "https://pro-api.coinmarketcap.com/v1";

// Enhanced cache with TTL and size limit
class EnhancedCache<T> {
  private cache: Map<string, { data: T; timestamp: number }>;
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(ttlSeconds: number = 30, maxSize: number = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlSeconds * 1000;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry
      const oldestKey = Array.from(this.cache.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)[0][0];
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, { data: value, timestamp: Date.now() });
  }

  get(key: string): T | undefined {
    const item = this.cache.get(key);
    if (!item) return undefined;
    if (Date.now() - item.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return item.data;
  }

  clear(): void {
    this.cache.clear();
  }
}

// Create cache instance
const mapCache = new EnhancedCache(30); // 30 seconds TTL

// CMC Error codes and messages
const CMC_ERRORS = {
  1001: 'Invalid API Key',
  1002: 'API key missing',
  1003: 'API Key requires activation',
  1004: 'API Key plan expired',
  1005: 'API Key required',
  1006: 'Endpoint not authorized for plan',
  1007: 'API Key disabled',
  1008: 'Rate limit reached (minute)',
  1009: 'Rate limit reached (day)',
  1010: 'Rate limit reached (month)',
  1011: 'IP rate limit reached'
} as const;

// Exponential backoff implementation
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<Response> {
  if (!CMC_API_KEY) {
    throw new Error('CMC API key not configured. Set CMC_API_KEY in your environment.');
  }
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Handle rate limiting
      if (response.status === 429) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Handle other errors
      if (!response.ok) {
        const errorData = await response.json();
        const errorCode = errorData?.status?.error_code;
        const code = Number(errorCode) as keyof typeof CMC_ERRORS;
        const errorMessage = (CMC_ERRORS as Record<number, string>)[code] || errorData?.status?.error_message;
        throw new Error(`CMC API Error (${response.status}): ${errorMessage}`);
      }

      return response;
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

// Platform schema
const PlatformSchema = z.object({
  id: z.number(),
  name: z.string(),
  symbol: z.string(),
  slug: z.string(),
  token_address: z.string().nullable().optional()
}).nullable();

// Cryptocurrency schema
const CryptoMapSchema = z.object({
  id: z.number(),
  rank: z.number().nullable().optional(),
  name: z.string(),
  symbol: z.string(),
  slug: z.string(),
  is_active: z.number(),
  first_historical_data: z.string().nullable().optional(),
  last_historical_data: z.string().nullable().optional(),
  platform: PlatformSchema,
  status: z.enum(['active', 'inactive', 'untracked']).optional()
});

// API response schema
const MapResponseSchema = z.object({
  status: z.object({
    timestamp: z.string(),
    error_code: z.number(),
    error_message: z.string().nullable(),
    elapsed: z.number(),
    credit_count: z.number()
  }),
  data: z.array(CryptoMapSchema)
});

// Helper to fetch data from CMC with enhanced error handling
async function fetchMap(params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${CMC_BASE_URL}/cryptocurrency/map`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));

  const response = await fetchWithRetry(url.toString(), {
    headers: {
      'X-CMC_PRO_API_KEY': CMC_API_KEY,
      'Accept': 'application/json',
      'Accept-Encoding': 'deflate, gzip'
    }
  });

  return response.json();
}

// Get map data with enhanced caching
async function getMapData(params: Record<string, string> = {}): Promise<any> {
  const cacheKey = JSON.stringify(params);
  const cached = mapCache.get(cacheKey);

  if (cached) return cached;

  const response = await fetchMap(params);
  const validatedResponse = MapResponseSchema.parse(response);

  mapCache.set(cacheKey, validatedResponse);
  return validatedResponse;
}

export const CMCMap = createTool({
  id: "CMC_Map",
  description: "Maps cryptocurrency symbols and IDs to detailed token information.",
  inputSchema: z.object({
    identifiers: z.string().describe('Comma-separated list of symbols or CMC IDs'),
    use_ids: z.boolean().optional().default(false).describe('Whether the identifiers are CMC IDs'),
    listing_status: z.enum(['active', 'inactive', 'untracked']).default('active')
      .describe('Filter by listing status'),
    aux: z.string().default('platform,first_historical_data,last_historical_data,is_active,status')
      .describe('Additional fields to include')
  }),
  async execute(input: any) {
    try {
      const inputData = input?.args || input?.context || input;

      // Build parameters
      const params: Record<string, string> = {
        aux: inputData.aux || 'platform,first_historical_data,last_historical_data,is_active,status',
        listing_status: inputData.listing_status || 'active'
      };

      // Handle both IDs and symbols
      if (inputData.use_ids) {
        params.id = inputData.identifiers;
      } else {
        params.symbol = inputData.identifiers;
      }

      const response = await getMapData(params);
      const tokens = response.data;

      // Format the response for each token
      const formattedTokens = tokens.map((token: any) => ({
        id: token.id,
        name: token.name,
        symbol: token.symbol,
        active_status: token.is_active === 1 ? 'Active' : 'Inactive',
        platform: token.platform ? {
          name: token.platform.name,
          token_address: token.platform.token_address || null
        } : 'Native Blockchain',
        historical_data: {
          first_data: token.first_historical_data,
          last_data: token.last_historical_data
        }
      }));

      return {
        tokens: formattedTokens,
        summary: {
          total_tokens: tokens.length,
          active_tokens: tokens.filter((t: any) => t.is_active === 1).length,
          platforms: [...new Set(tokens.map((t: any) => t.platform?.name || 'Native Blockchain'))].length
        },
        timestamp: response.status.timestamp,
        credits_used: response.status.credit_count
      };
    } catch (error) {
      // Enhanced error handling
      const err = error as Error;
      console.error('Error in CMCMap tool:', err);

      // Format error response
      return {
        error: true,
        message: err.message,
        timestamp: new Date().toISOString(),
        suggestion: err.message.includes('rate limit') ?
          'Please wait and try again later. The API rate limit will reset in a minute.' :
          'Please check your input parameters and try again.'
      };
    }
  }
});
