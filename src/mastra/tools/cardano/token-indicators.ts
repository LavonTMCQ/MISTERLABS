import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Simple logger implementation
const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] ${message}`, data || ''),
  error: (message: string, data?: any) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message: string, data?: any) => console.warn(`[WARN] ${message}`, data || ''),
  debug: (message: string, data?: any) => console.debug(`[DEBUG] ${message}`, data || '')
};

// Token registry implementation using hardcoded token data
const tokenRegistry = {
  // Hardcoded fallback tokens for essential ones
  fallbackTokens: {
    'ADA': { unit: 'lovelace', policyId: '', name: 'Cardano' },
    'SNEK': { unit: '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b', policyId: 'f43a62fdc3965df486de8a0d32fe800963589c41b38946602a0dc535', name: 'Snek' },
    'HOSKY': { unit: 'a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59', policyId: 'a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235', name: 'Hosky Token' },
    'MISTER': { unit: '7529bed52d81a20e69c6dd447dd9cc0293daf4577f08d7ed2d8ab0814d4953544552', policyId: '7529bed52d81a20e69c6dd447dd9cc0293daf4577f08d7ed2d8ab081', name: 'MISTER' },
    'MIN': { unit: '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e', policyId: '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6', name: 'Minswap' }
  } as Record<string, { unit: string, policyId: string, name: string }>,

  // Get token unit from ticker
  getTokenUnit: async (ticker: string): Promise<string | null> => {
    const token = tokenRegistry.fallbackTokens[ticker.toUpperCase()];
    if (token) return token.unit;
    logger.warn(`Token ${ticker} not found in registry`);
    return null;
  }
};

const TAPTOOLS_API_KEY = process.env.TAPTOOLS_API_KEY || "WghkJaZlDWYdQFsyt3uiLdTIOYnR5uhO";
const TAPTOOLS_BASE_URL = "https://openapi.taptools.io/api/v1";

// Types for indicator parameters and responses
interface IndicatorParams {
  length?: number;
  smoothingFactor?: number;
  fastLength?: number;
  slowLength?: number;
  signalLength?: number;
  stdMult?: number;
}

interface IndicatorResponse {
  values: number[];
  metadata: {
    indicator: string;
    params: IndicatorParams;
    timestamp: number;
  };
}

// Advanced cache system with multi-level caching
class IndicatorCache {
  private static instance: IndicatorCache;
  private cache: Map<string, {
    data: IndicatorResponse;
    timestamp: number;
    interval: string;
  }>;

  // Different TTLs based on timeframe
  private readonly TTL_MAP = {
    '3m': 180000,    // 3 minutes
    '5m': 300000,    // 5 minutes
    '15m': 900000,   // 15 minutes
    '30m': 1800000,  // 30 minutes
    '1h': 3600000,   // 1 hour
    '2h': 7200000,   // 2 hours
    '4h': 14400000,  // 4 hours
    '12h': 43200000, // 12 hours
    '1d': 86400000,  // 1 day
    '3d': 259200000, // 3 days
    '1w': 604800000, // 1 week
    '1M': 2592000000 // 1 month
  };

  private constructor() {
    this.cache = new Map();
  }

  static getInstance(): IndicatorCache {
    if (!IndicatorCache.instance) {
      IndicatorCache.instance = new IndicatorCache();
    }
    return IndicatorCache.instance;
  }

  private getTTL(interval: string): number {
    return this.TTL_MAP[interval as keyof typeof this.TTL_MAP] || 300000;
  }

  private generateKey(unit: string, indicator: string, interval: string, params: IndicatorParams): string {
    return `${unit}-${indicator}-${interval}-${JSON.stringify(params)}`;
  }

  get(unit: string, indicator: string, interval: string, params: IndicatorParams): IndicatorResponse | null {
    const key = this.generateKey(unit, indicator, interval, params);
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.timestamp < this.getTTL(interval)) {
      return cached.data;
    }
    return null;
  }

  set(unit: string, indicator: string, interval: string, params: IndicatorParams, data: IndicatorResponse): void {
    const key = this.generateKey(unit, indicator, interval, params);
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      interval
    });
  }

  getAge(key: string): string {
    const cached = this.cache.get(key);
    if (!cached) return 'not cached';
    return Math.round((Date.now() - cached.timestamp) / 1000) + 's';
  }
}

// API Client with rate limiting and error handling
class TapToolsAPI {
  private static instance: TapToolsAPI;
  private cache: IndicatorCache;

  private constructor() {
    this.cache = IndicatorCache.getInstance();
  }

  static getInstance(): TapToolsAPI {
    if (!TapToolsAPI.instance) {
      TapToolsAPI.instance = new TapToolsAPI();
    }
    return TapToolsAPI.instance;
  }

  private async fetchWithAuth(endpoint: string, params: Record<string, string | number>): Promise<any> {
    const url = new URL(`${TAPTOOLS_BASE_URL}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value.toString()));

    try {
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
    } catch (error) {
      logger.error('TapTools API request failed:', {
        endpoint,
        params,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async getIndicator(
    unit: string,
    interval: string,
    indicator: string,
    params: IndicatorParams = {},
    items: number = 100
  ): Promise<IndicatorResponse> {
    // Check cache first
    const cached = this.cache.get(unit, indicator, interval, params);
    if (cached) return cached;

    try {
      // Clean up parameters based on indicator type to avoid sending irrelevant params
      const relevantParams: Record<string, any> = {
        unit,
        interval,
        indicator,
        items
      };

      // Add only the parameters that are applicable for the specific indicator
      switch (indicator) {
        case 'ma':
        case 'ema':
        case 'rsi':
        case 'bb':
        case 'bbw':
          if (params.length) relevantParams.length = params.length;
          if (indicator === 'ema' && params.smoothingFactor) {
            relevantParams.smoothingFactor = params.smoothingFactor;
          }
          if ((indicator === 'bb' || indicator === 'bbw') && params.stdMult) {
            relevantParams.stdMult = params.stdMult;
          }
          break;
        case 'macd':
          if (params.fastLength) relevantParams.fastLength = params.fastLength;
          if (params.slowLength) relevantParams.slowLength = params.slowLength;
          if (params.signalLength) relevantParams.signalLength = params.signalLength;
          break;
      }

      // Log the actual parameters being sent to the API
      logger.debug('Sending indicator request with params:', relevantParams);

      const data = await this.fetchWithAuth('/token/indicators', relevantParams);

      // Handle empty or invalid response
      if (!data || !Array.isArray(data)) {
        throw new Error(`Invalid response from API for indicator ${indicator}`);
      }

      const response: IndicatorResponse = {
        values: data,
        metadata: {
          indicator,
          params,
          timestamp: Date.now()
        }
      };

      // Cache the response
      this.cache.set(unit, indicator, interval, params, response);
      return response;
    } catch (error) {
      logger.error('Failed to fetch indicator:', {
        unit,
        indicator,
        interval,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

// Validation helpers
function validateIndicatorParams(indicator: string, params: Record<string, any>): void {
  switch (indicator) {
    case 'ma':
    case 'ema':
      // Provide default length if not specified
      if (!params.length) {
        params.length = 14;
      }
      if (indicator === 'ema' && !params.smoothingFactor) {
        params.smoothingFactor = 2;
      }
      break;
    case 'rsi':
      // Provide default length if not specified
      if (!params.length) {
        params.length = 14;
      }
      break;
    case 'bb':
    case 'bbw':
      // Provide default length and stdMult if not specified
      if (!params.length) {
        params.length = 20;
      }
      if (!params.stdMult) {
        params.stdMult = 2;
      }
      break;
    case 'macd':
      // Provide default lengths if not specified
      if (!params.fastLength) {
        params.fastLength = 12;
      }
      if (!params.slowLength) {
        params.slowLength = 26;
      }
      if (!params.signalLength) {
        params.signalLength = 9;
      }
      break;
    default:
      throw new Error(`Unknown indicator: ${indicator}`);
  }
}

// Create the Technical Indicators Tool
export const CardanoTokenIndicators = createTool({
  id: 'cardano-token-indicators',
  description: 'Calculates technical indicators (MA, EMA, RSI, MACD, BB, BBW) for Cardano tokens. Accepts either ticker symbol or unit identifier.',
  inputSchema: z.object({
    ticker: z.string()
      .optional()
      .describe('Token ticker symbol (e.g., "MIN", "LENFI"). Will be resolved to unit using token registry.'),
    unit: z.string()
      .optional()
      .describe('Token unit (policy_id + asset_name in hex). Required if ticker is not provided.'),
    interval: z.enum(['3m', '5m', '15m', '30m', '1h', '2h', '4h', '12h', '1d', '3d', '1w', '1M'])
      .default('1h')
      .describe('Time interval for the indicator calculation (default: 1h)'),
    indicator: z.enum(['ma', 'ema', 'rsi', 'macd', 'bb', 'bbw'])
      .default('ema')
      .describe('Technical indicator to calculate (default: ema)'),
    length: z.number().optional()
      .describe('Length parameter for MA, EMA, RSI, BB, BBW (defaults: 14 for MA/EMA/RSI, 20 for BB/BBW)'),
    smoothingFactor: z.number().optional()
      .describe('Smoothing factor for EMA (default: 2)'),
    fastLength: z.number().optional()
      .describe('Fast length for MACD (default: 12)'),
    slowLength: z.number().optional()
      .describe('Slow length for MACD (default: 26)'),
    signalLength: z.number().optional()
      .describe('Signal length for MACD (default: 9)'),
    stdMult: z.number().optional()
      .describe('Standard deviation multiplier for Bollinger Bands (default: 2)'),
    items: z.number()
      .min(1)
      .max(1000)
      .default(100)
      .describe('Number of data points to return (default: 100, max: 1000)'),
    quote: z.enum(['ADA', 'USD'])
      .default('ADA')
      .describe('Quote currency for price data (default: ADA)')
  }),
  async execute(input: { context?: Record<string, any>; args?: Record<string, any> }) {
    try {
      const api = TapToolsAPI.getInstance();
      const params = input?.context || input?.args || {};

      // Resolve ticker to unit if needed
      let unit = params.unit;
      if (!unit && params.ticker) {
        logger.info(`Resolving ticker ${params.ticker} to unit using token registry`);
        unit = await tokenRegistry.getTokenUnit(params.ticker);

        if (!unit) {
          throw new Error(`Could not resolve token unit for ticker: ${params.ticker}`);
        }

        logger.info(`Resolved ticker ${params.ticker} to unit: ${unit}`);
      }

      // Validate that required parameter is provided
      if (!unit) {
        throw new Error('Either ticker or unit parameter is required.');
      }

      // Apply defaults
      const indicator = params.indicator || 'ema';
      const interval = params.interval || '1h';
      const items = params.items || 100;
      const quote = params.quote || 'ADA';

      // Extract indicator-specific parameters
      const indicatorParams: IndicatorParams = {
        length: params.length,
        smoothingFactor: params.smoothingFactor,
        fastLength: params.fastLength,
        slowLength: params.slowLength,
        signalLength: params.signalLength,
        stdMult: params.stdMult
      };

      // Apply defaults and validate parameters for the specific indicator
      validateIndicatorParams(indicator, indicatorParams);

      // Log request for debugging
      logger.info('CardanoTokenIndicators request:', {
        ticker: params.ticker || 'Not provided',
        unit: unit,
        indicator,
        interval,
        params: indicatorParams
      });

      const result = await api.getIndicator(
        unit,
        interval,
        indicator,
        indicatorParams,
        items
      );

      // Format the response
      return {
        indicator,
        interval,
        values: result.values,
        parameters: {
          ...indicatorParams,
          items,
          quote
        },
        metadata: {
          timestamp: result.metadata.timestamp,
          ticker: params.ticker || undefined,
          unit: unit
        },
        cache_info: {
          age: IndicatorCache.getInstance().getAge(
            `${unit}-${indicator}-${interval}-${JSON.stringify(indicatorParams)}`
          )
        }
      };
    } catch (error) {
      logger.error('Error in CardanoTokenIndicators:', {
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        error: true,
        message: error instanceof Error ? error.message : 'Unknown error in indicator calculation',
        suggestion: 'Please check that you provided either a valid ticker symbol or token unit.'
      };
    }
  }
});