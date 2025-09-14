import { z } from 'zod';
import { createTool } from "@mastra/core/tools";

const CMC_API_KEY = process.env.CMC_API_KEY || process.env.COINMARKETCAP_API_KEY || '';
const CMC_BASE_URL = "https://pro-api.coinmarketcap.com/v2";

// Cache for OHLCV data
const ohlcvCache = new Map<string, { data: any; timestamp: number }>();

// Schema for OHLCV data
const QuoteSchema = z.object({
  time_open: z.string(),
  time_close: z.string(),
  time_high: z.string(),
  time_low: z.string(),
  quote: z.object({
    USD: z.object({
      open: z.number(),
      high: z.number(),
      low: z.number(),
      close: z.number(),
      volume: z.number().nullable().optional(), // Allow null or undefined for volume
      market_cap: z.number().nullable().optional(), // Allow null or undefined for market_cap
      timestamp: z.string()
    })
  })
});

const OHLCVDataSchema = z.object({
  id: z.number(),
  name: z.string(),
  symbol: z.string(),
  quotes: z.array(QuoteSchema)
});

const CMCResponseSchema = z.object({
  status: z.object({
    timestamp: z.string(),
    error_code: z.number(),
    error_message: z.string().nullable(),
    elapsed: z.number(),
    credit_count: z.number(),
    notice: z.string().nullable()
  }),
  data: z.record(z.array(OHLCVDataSchema))
});

// Helper to fetch data from CMC
async function fetchFromCMC(endpoint: string, params: Record<string, string> = {}) {
  if (!CMC_API_KEY) {
    throw new Error('CMC API key not configured. Set CMC_API_KEY in your environment.');
  }
  const url = new URL(`${CMC_BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));

  console.log('Fetching OHLCV from CMC:', {
    url: url.toString(),
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

  return response.json();
}

// Get OHLCV data
async function getOHLCVData(
  symbol: string,
  timePeriod: 'daily' | 'hourly',
  interval?: string,
  timeStart?: string,
  timeEnd?: string,
  count: number = 100,
  convert: string = 'USD'
): Promise<any> {
  const cacheKey = `${symbol}-${timePeriod}-${interval}-${timeStart}-${timeEnd}-${count}-${convert}`;
  const cached = ohlcvCache.get(cacheKey);

  // Use appropriate cache duration based on time period
  const cacheDuration = timePeriod === 'hourly' ? 300000 : 600000; // 5 mins for hourly, 10 mins for daily
  if (cached && Date.now() - cached.timestamp < cacheDuration) {
    return cached.data;
  }

  const params: Record<string, string> = {
    symbol,
    time_period: timePeriod,
    count: count.toString(),
    convert
  };

  if (interval) params.interval = interval;
  if (timeStart) params.time_start = timeStart;
  if (timeEnd) params.time_end = timeEnd;

  const response = await fetchFromCMC('/cryptocurrency/ohlcv/historical', params);

  try {
    // Validate response against schema
    const validatedResponse = CMCResponseSchema.parse(response);

    if (!validatedResponse.data[symbol]?.[0]) {
      throw new Error(`No OHLCV data returned for ${symbol}`);
    }

    return validatedResponse;
  } catch (error) {
    console.error('Schema validation error:', error);

    // If validation fails, try to return a usable response anyway
    if (response && response.data && response.data[symbol] && response.data[symbol][0]) {
      console.log('Returning unvalidated response as fallback');
      return response;
    }

    throw new Error(`Failed to validate OHLCV data for ${symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Cache the response (either validated or fallback)
  ohlcvCache.set(cacheKey, {
    data: response,
    timestamp: Date.now()
  });
  return response;
}

export const CMCOHLCV = createTool({
  id: "CMC_OHLCV",
  description: "Fetches OHLCV (Open, High, Low, Close, Volume) data from CoinMarketCap v2 API. Supports both daily and hourly intervals with flexible time ranges.",
  inputSchema: z.object({
    symbol: z.string().describe('Cryptocurrency symbol (e.g., "BTC", "ETH")'),
    time_period: z.enum(['daily', 'hourly']).default('daily').describe('Time period for OHLCV data'),
    interval: z.enum([
      'hourly', 'daily', 'weekly', 'monthly', 'yearly',
      '1h', '2h', '3h', '4h', '6h', '12h',
      '1d', '2d', '3d', '7d', '14d', '15d', '30d', '60d', '90d', '365d'
    ]).optional().describe('Interval for sampling time periods'),
    time_start: z.string().optional().describe('Start time (ISO 8601 or Unix timestamp)'),
    time_end: z.string().optional().describe('End time (ISO 8601 or Unix timestamp)'),
    count: z.number().min(1).max(10000).optional().default(10).describe('Number of time periods'),
    convert: z.string().optional().default('USD').describe('Currency to convert quotes to')
  }),
  async execute(input: any) {
    try {
      // Extract parameters from input
      const inputData = input?.args || input?.context || input;
      const params = {
        symbol: String(inputData?.symbol || ''),
        time_period: inputData?.time_period || 'daily',
        interval: inputData?.interval,
        time_start: inputData?.time_start,
        time_end: inputData?.time_end,
        count: Number(inputData?.count || 10),
        convert: String(inputData?.convert || 'USD')
      };

      // Log parameters
      console.log('OHLCV Request:', {
        symbol: params.symbol,
        time_period: params.time_period,
        interval: params.interval,
        count: params.count
      });

      // Validate required parameters
      if (!params.symbol) {
        throw new Error('Missing required parameter: symbol');
      }

      // Special handling for MISTER and SNEK tokens which are not on CoinMarketCap
      if (params.symbol === 'MISTER' || params.symbol === 'SNEK') {
        throw new Error(`${params.symbol} is a Cardano native token not available on CoinMarketCap. Please use CardanoTokenOHLCV instead.`);
      }

      const response = await getOHLCVData(
        params.symbol,
        params.time_period,
        params.interval,
        params.time_start,
        params.time_end,
        params.count,
        params.convert
      );

      // Extract the relevant data for the requested symbol
      const symbolData = response.data[params.symbol]?.[0];
      if (!symbolData) {
        throw new Error(`No data found for symbol: ${params.symbol}`);
      }

      // Format the response
      return {
        asset: {
          id: symbolData.id,
          name: symbolData.name,
          symbol: symbolData.symbol,
          time_period: params.time_period
        },
        ohlcv_data: symbolData.quotes.map((quote: any) => ({
          time_open: quote.time_open,
          time_close: quote.time_close,
          time_high: quote.time_high,
          time_low: quote.time_low,
          metrics: {
            open: quote.quote.USD.open,
            high: quote.quote.USD.high,
            low: quote.quote.USD.low,
            close: quote.quote.USD.close,
            volume: quote.quote.USD.volume !== null ? quote.quote.USD.volume : 0, // Use 0 if volume is null
            market_cap: quote.quote.USD.market_cap !== null ? quote.quote.USD.market_cap : 0, // Use 0 if market_cap is null
            timestamp: quote.quote.USD.timestamp
          }
        })),
        query_params: {
          time_period: params.time_period,
          interval: params.interval || params.time_period,
          time_range: {
            start: params.time_start || 'default',
            end: params.time_end || 'current'
          },
          points_returned: symbolData.quotes.length
        },
        status: response.status,
        cache_info: {
          age: Math.round((Date.now() - (ohlcvCache.get(
            `${params.symbol}-${params.time_period}-${params.interval}-${params.time_start}-${params.time_end}-${params.count}-${params.convert}`
          )?.timestamp || 0)) / 1000) + 's'
        }
      };
    } catch (error) {
      console.error('Error in CMCOHLCV tool:', error);

      // Return a more user-friendly error response instead of throwing
      return {
        error: true,
        message: error instanceof Error ? error.message : 'Unknown error in OHLCV data retrieval',
        suggestion: 'Please verify your input parameters. For hourly data with BTC, some volume data may be missing. Try using daily data or a different time period.'
      };
    }
  }
});
