import { z } from 'zod';
import { createTool } from "@mastra/core/tools";

const CMC_API_KEY = process.env.CMC_API_KEY || process.env.COINMARKETCAP_API_KEY || '';
const CMC_BASE_URL = "https://pro-api.coinmarketcap.com/v1";

// Cache for global metrics data
const globalMetricsCache = new Map<string, { data: any; timestamp: number }>();

interface GlobalQuote {
  total_market_cap: number;
  total_volume_24h: number;
  total_volume_24h_reported: number;
  altcoin_volume_24h: number;
  altcoin_volume_24h_reported: number;
  altcoin_market_cap: number;
}

interface GlobalMetricsData {
  btc_dominance: number;
  eth_dominance: number;
  active_cryptocurrencies: number;
  total_cryptocurrencies: number;
  active_market_pairs: number;
  active_exchanges: number;
  total_exchanges: number;
  last_updated: string;
  quote: Record<string, GlobalQuote>;
}

// Schema for global metrics data
const GlobalMetricsSchema = z.object({
  btc_dominance: z.number(),
  eth_dominance: z.number(),
  active_cryptocurrencies: z.number(),
  total_cryptocurrencies: z.number(),
  active_market_pairs: z.number(),
  active_exchanges: z.number(),
  total_exchanges: z.number(),
  last_updated: z.string(),
  quote: z.record(z.object({
    total_market_cap: z.number(),
    total_volume_24h: z.number(),
    total_volume_24h_reported: z.number(),
    altcoin_volume_24h: z.number(),
    altcoin_volume_24h_reported: z.number(),
    altcoin_market_cap: z.number()
  }))
});

// Helper to fetch data from CMC
async function fetchFromCMC(endpoint: string, params: Record<string, string> = {}) {
  if (!CMC_API_KEY) {
    throw new Error('CMC API key not configured. Set CMC_API_KEY in your environment.');
  }
  const url = new URL(`${CMC_BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));

  console.log('Fetching from CMC:', {
    url: url.toString(),
    headers: {
      'X-CMC_PRO_API_KEY': CMC_API_KEY,
      'Accept': 'application/json'
    },
    params
  });

  const response = await fetch(url.toString(), {
    headers: {
      'X-CMC_PRO_API_KEY': CMC_API_KEY,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    console.error('CMC API Error:', {
      status: response.status,
      statusText: response.statusText,
      errorData
    });
    throw new Error(`CMC API request failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data;
}

// Get latest global metrics
async function getGlobalMetrics(convert: string): Promise<GlobalMetricsData> {
  const cacheKey = convert;
  const cached = globalMetricsCache.get(cacheKey);
  
  // Use 5-minute cache as per CMC's update frequency
  if (cached && Date.now() - cached.timestamp < 300000) {
    return cached.data;
  }

  const data = await fetchFromCMC('/global-metrics/quotes/latest', {
    convert
  });

  globalMetricsCache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}

export const CMCglobalmetrics = createTool({
  id: "CoinMarketCap Global Metrics",
  description: "Fetches global cryptocurrency market metrics from CoinMarketCap including market cap, volume, and dominance data.",
  inputSchema: z.object({
    convert: z.string().optional().default('USD').describe('Currency to convert metrics to')
  }),
  async execute({ context: { convert = 'USD' } }) {
    try {
      const metrics = await getGlobalMetrics(convert);
      
      // Parse and validate data
      const globalData = GlobalMetricsSchema.parse(metrics);

      return {
        dominance: {
          btc: globalData.btc_dominance,
          eth: globalData.eth_dominance
        },
        stats: {
          active_cryptocurrencies: globalData.active_cryptocurrencies,
          total_cryptocurrencies: globalData.total_cryptocurrencies,
          active_market_pairs: globalData.active_market_pairs,
          active_exchanges: globalData.active_exchanges,
          total_exchanges: globalData.total_exchanges
        },
        metrics: globalData.quote[convert],
        last_updated: globalData.last_updated,
        cacheInfo: {
          metricsAge: Math.round((Date.now() - (globalMetricsCache.get(convert)?.timestamp || 0)) / 1000) + 's'
        }
      };
    } catch (error) {
      console.error('Error in CMCglobalmetrics tool:', error);
      throw error;
    }
  }
});
