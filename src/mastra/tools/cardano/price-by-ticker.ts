import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// A thin router that always resolves Cardano tickers -> unit, then fetches OHLCV via TapTools
export const cardanoPriceByTicker = createTool({
  id: 'cardano-price-by-ticker',
  description: 'For Cardano tokens. Resolve ticker -> unit, then fetch OHLCV/prices from TapTools. Use this for $SNEK, $MISTER, etc. Not for BTC/ETH/SOL.',
  inputSchema: z.object({
    ticker: z.string().describe('Cardano token ticker, e.g., "SNEK", "MISTER"'),
    days: z.number().min(1).max(365).default(10).describe('How many daily candles to fetch (default 10)'),
    format: z.enum(['summary', 'chart', 'raw']).default('summary')
  }),
  execute: async ({ context: { ticker, days, format } }) => {
    try {
      const { tickerToUnitTool } = await import('./ticker-to-unit');
      const { ohlcvDataTool } = await import('./ohlcv-data');

      const resolve = await (tickerToUnitTool as any).execute({
        context: { ticker, searchLimit: 10 }
      });

      if (!resolve?.success || !resolve.data?.unit) {
        return {
          success: false,
          error: `Could not resolve ticker '${ticker}' to a Cardano unit`,
          suggestions: [
            'Check ticker spelling',
            'Try the project name',
            'Confirm token exists on Cardano'
          ]
        };
      }

      const unit = resolve.data.unit as string;
      const ohlcv = await (ohlcvDataTool as any).execute({
        context: { token: unit, interval: '1d', numIntervals: days, includeTechnicals: true, format }
      });

      return ohlcv;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown router error',
      };
    }
  }
});

