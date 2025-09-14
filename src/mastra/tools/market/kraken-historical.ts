import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const krakenHistoricalTool = createTool({
  id: 'kraken-historical',
  description: 'Get historical OHLC data for cryptocurrencies from Kraken API (free data back to 2013)',
  inputSchema: z.object({
    pair: z.string().default('ADAUSD').describe('Trading pair (e.g., ADAUSD, BTCUSD, ETHUSD)'),
    interval: z.enum(['1', '5', '15', '30', '60', '240', '1440', '10080', '21600']).default('1440').describe('Time interval in minutes (1440 = daily)'),
    since: z.number().optional().describe('Unix timestamp to get data from (optional)')
  }),
  execute: async ({ context: { pair, interval, since } }) => {
    try {
      console.log(`[KRAKEN] Fetching historical data for ${pair}, interval: ${interval}min`);

      let url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`;
      if (since) {
        url += `&since=${since}`;
      }

      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Kraken API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.error && data.error.length > 0) {
        throw new Error(`Kraken API error: ${data.error.join(', ')}`);
      }

      // Extract OHLC data
      const pairKey = Object.keys(data.result || {}).find(key => key !== 'last');
      if (!pairKey) {
        throw new Error('No OHLC data found in response');
      }

      const ohlcData = data.result[pairKey];
      const lastTimestamp = data.result.last;

      // Process OHLC data
      const candles = ohlcData.map((candle: any[]) => ({
        timestamp: parseInt(candle[0]) * 1000, // Convert to milliseconds
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        vwap: parseFloat(candle[5]), // Volume weighted average price
        volume: parseFloat(candle[6]),
        count: parseInt(candle[7]) // Number of trades
      }));

      // Calculate statistics
      const latestCandle = candles[candles.length - 1];
      const oldestCandle = candles[0];
      const priceChange = latestCandle ? latestCandle.close - oldestCandle.close : 0;
      const priceChangePercent = oldestCandle ? (priceChange / oldestCandle.close) * 100 : 0;

      console.log(`[KRAKEN] Retrieved ${candles.length} data points for ${pair}`);
      if (latestCandle) {
        console.log(`[KRAKEN] Latest ${pair}: $${latestCandle.close.toFixed(6)} (${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%)`);
      }

      return {
        success: true,
        data: {
          pair,
          interval: `${interval}min`,
          candles,
          count: candles.length,
          latest: latestCandle,
          oldest: oldestCandle,
          stats: {
            priceChange,
            priceChangePercent,
            totalVolume: candles.reduce((sum: number, candle: any) => sum + candle.volume, 0),
            avgVolume: candles.length > 0 ? candles.reduce((sum: number, candle: any) => sum + candle.volume, 0) / candles.length : 0,
            highestPrice: Math.max(...candles.map((c: any) => c.high)),
            lowestPrice: Math.min(...candles.map((c: any) => c.low))
          },
          lastTimestamp,
          provider: 'Kraken'
        },
        message: `Retrieved ${candles.length} historical data points for ${pair}`
      };

    } catch (error) {
      console.error('[KRAKEN] Historical data fetch failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: `Failed to fetch historical data for ${pair} from Kraken API`
      };
    }
  }
});

// Helper function to get recent ADA price history
export async function getADAHistoryFromKraken(days: number = 7): Promise<any[]> {
  try {
    const { RuntimeContext } = await import('@mastra/core/runtime-context');
    const result: any = await (krakenHistoricalTool as any).execute({
      context: {
        pair: 'ADAUSD',
        interval: '1440', // Daily data
      },
      runtimeContext: new RuntimeContext(),
    });
    
    if (result.success && result.data?.candles) {
      // Return last N days
      return result.data.candles.slice(-days);
    }
    
    return [];
  } catch (error) {
    console.warn('Failed to get ADA history from Kraken');
    return [];
  }
}
