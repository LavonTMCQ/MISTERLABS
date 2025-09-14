import { z } from 'zod';
import { createTool } from "@mastra/core/tools";

const CMC_API_KEY = process.env.CMC_API_KEY || process.env.COINMARKETCAP_API_KEY || '';
const CMC_BASE_URL = "https://pro-api.coinmarketcap.com/v1";

// Cache for quotes data
const quotesCache = new Map<string, { data: any; timestamp: number }>();

// Helper to normalize symbol
const normalizeSymbol = (symbol: string) => symbol.toUpperCase();

interface CryptoQuote {
  price: number;
  volume_24h: number | null;
  market_cap: number;
  percent_change_1h: number | null;
  percent_change_24h: number | null;
  percent_change_7d: number | null;
  percent_change_30d: number | null;
}

interface CryptoData {
  name: string;
  symbol: string;
  cmc_rank: number | null;
  circulating_supply: number;
  total_supply: number | null;
  max_supply: number | null;
  quote: Record<string, CryptoQuote>;
}

// Schema for crypto data
const CryptoDataSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  cmc_rank: z.number().nullable().default(0),
  circulating_supply: z.number(),
  total_supply: z.number().nullable(),
  max_supply: z.number().nullable(),
  quote: z.record(z.object({
    price: z.number(),
    volume_24h: z.number().nullable().default(0),
    market_cap: z.number(),
    percent_change_1h: z.number().nullable().default(0),
    percent_change_24h: z.number().nullable().default(0),
    percent_change_7d: z.number().nullable().default(0),
    percent_change_30d: z.number().nullable().default(0)
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

// Get latest quotes for a symbol
async function getLatestQuotes(symbol: string, convert: string): Promise<Record<string, CryptoData>> {
  const cacheKey = `${symbol}-${convert}`;
  const cached = quotesCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < 60000) { // 1 minute cache
    return cached.data;
  }

  const data = await fetchFromCMC('/cryptocurrency/quotes/latest', {
    symbol: normalizeSymbol(symbol),
    convert
  });

  quotesCache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}

export const CMCquoteslatest = createTool({
  id: "CoinMarketCap Quotes Latest",
  description: "Fetches cryptocurrency data from CoinMarketCap including latest quotes and market metrics.",
  inputSchema: z.object({
    symbol: z.string().describe('Cryptocurrency symbol (e.g., "BTC", "ADA")'),
    convert: z.string().optional().default('USD').describe('Currency to convert to')
  }),
  async execute({ context: { symbol, convert = 'USD' } }) {
    try {
      // Check if this is a Cardano token (except ADA)
      const cardanoTokens = [
        'MISTER', 'SNEK', 'HOSKY', 'DJED', 'SHEN', 'AGIX', 'LQ', 'LENFI', 'SUNDAE', 'NTX', 'INDY', 'WMT', 'IAG', 'MILK',
        'WLK', 'VIPER', 'PAVIA', 'SOC', 'TOOL', 'SUGR', 'DIS', 'MAYZ', 'CSWAPC', 'SKY', 'DRIP', 'FRN', 'SPXT', 'LIFI',
        'BOO', 'AXO', 'BULL', 'DING', 'OPT', 'MyUSD', 'JELLY', 'STRCH', 'SPF', '$LOBSTER', '$DERP', 'SHARL', '$DUX'
      ];

      if (symbol !== 'ADA' && cardanoTokens.includes(symbol.toUpperCase())) {
        throw new Error(`${symbol} is a Cardano native token not available on CoinMarketCap. Please use CardanoTokenOHLCV or CardanoTokenLinks instead. Only ADA should be queried using CMC tools, all other Cardano tokens should use the Cardano-specific tools.`);
      }

      // Also check if the symbol contains a $ which is common for Cardano tokens
      if (symbol.includes('$') && symbol !== 'ADA') {
        throw new Error(`${symbol} appears to be a Cardano native token (has $ prefix). Please use CardanoTokenOHLCV or CardanoTokenLinks instead.`);
      }

      // Only fetch quotes since that's what our API key has access to
      const quotes = await getLatestQuotes(symbol, convert);

      // Parse and validate data
      const cryptoData = CryptoDataSchema.parse(quotes[normalizeSymbol(symbol)]);

      return {
        symbol: normalizeSymbol(symbol),
        name: cryptoData.name,
        rank: cryptoData.cmc_rank,
        quote: cryptoData.quote[convert],
        supply: {
          circulating: cryptoData.circulating_supply,
          total: cryptoData.total_supply,
          max: cryptoData.max_supply
        },
        cacheInfo: {
          quotesAge: Math.round((Date.now() - (quotesCache.get(`${symbol}-${convert}`)?.timestamp || 0)) / 1000) + 's'
        }
      };
    } catch (error) {
      console.error('Error in CMCquoteslatest tool:', error);
      throw error;
    }
  }
});
