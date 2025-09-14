import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const krakenPriceTool = createTool({
  id: 'kraken-price',
  description: 'Get current cryptocurrency prices from Kraken API (ADA, BTC, ETH, SOL, SUI, and all top 30 coins)',
  inputSchema: z.object({
    pairs: z.array(z.string()).default(['ADAUSD', 'BTCUSD']).describe('Trading pairs to fetch (e.g., ADAUSD, BTCUSD, ETHUSD, SOLUSD, SUIUSD)'),
    symbols: z.array(z.string()).optional().describe('Alternative: coin symbols to auto-convert to USD pairs (e.g., ADA, BTC, ETH)')
  }),
  execute: async ({ context: { pairs, symbols } }) => {
    try {
      // Convert symbols to USD pairs if provided
      let finalPairs = pairs;
      if (symbols && symbols.length > 0) {
        finalPairs = symbols.map(symbol => {
          // Map common symbols to Kraken pair format
          const symbolMap: Record<string, string> = {
            'ADA': 'ADAUSD',
            'BTC': 'BTCUSD', 
            'ETH': 'ETHUSD',
            'SOL': 'SOLUSD',
            'SUI': 'SUIUSD',
            'AVAX': 'AVAXUSD',
            'DOT': 'DOTUSD',
            'MATIC': 'MATICUSD',
            'ATOM': 'ATOMUSD',
            'LINK': 'LINKUSD',
            'UNI': 'UNIUSD',
            'LTC': 'LTCUSD',
            'BCH': 'BCHUSD',
            'XRP': 'XRPUSD',
            'DOGE': 'DOGEUSD',
            'SHIB': 'SHIBUSD',
            'TRX': 'TRXUSD',
            'TON': 'TONUSD',
            'XLM': 'XLMUSD',
            'ALGO': 'ALGOUSD',
            'VET': 'VETUSD',
            'ICP': 'ICPUSD',
            'FIL': 'FILUSD',
            'HBAR': 'HBARUSD',
            'APT': 'APTUSD',
            'NEAR': 'NEARUSD',
            'OP': 'OPUSD',
            'ARB': 'ARBUSD',
            'IMX': 'IMXUSD',
            'STX': 'STXUSD'
          };
          return symbolMap[symbol.toUpperCase()] || `${symbol.toUpperCase()}USD`;
        });
      }

      console.log(`[KRAKEN] Fetching prices for pairs: ${finalPairs.join(', ')}`);

      const pairQuery = finalPairs.join(',');
      const response = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pairQuery}`);
      
      if (!response.ok) {
        throw new Error(`Kraken API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.error && data.error.length > 0) {
        throw new Error(`Kraken API error: ${data.error.join(', ')}`);
      }

      const prices: Record<string, any> = {};
      const results = [];

      for (const [pair, tickerData] of Object.entries(data.result || {})) {
        const ticker = tickerData as any;
        const cleanPair = pair.replace('ZUSD', 'USD').replace('XXBT', 'BTC').replace('XETH', 'ETH');
        
        const priceInfo = {
          pair: cleanPair,
          symbol: cleanPair.replace('USD', ''),
          price: parseFloat(ticker.c[0]), // Last trade price
          ask: parseFloat(ticker.a[0]),   // Ask price
          bid: parseFloat(ticker.b[0]),   // Bid price
          volume24h: parseFloat(ticker.v[1]), // 24h volume
          high24h: parseFloat(ticker.h[1]),   // 24h high
          low24h: parseFloat(ticker.l[1]),    // 24h low
          change24h: parseFloat(ticker.p[1]), // 24h price change
          timestamp: Date.now()
        };

        prices[cleanPair] = priceInfo;
        results.push(priceInfo);
      }

      // Log key prices for MISTER
      const adaPrice = prices['ADAUSD']?.price;
      const btcPrice = prices['BTCUSD']?.price;
      
      if (adaPrice) console.log(`[KRAKEN] ADA: $${adaPrice.toFixed(6)}`);
      if (btcPrice) console.log(`[KRAKEN] BTC: $${btcPrice.toFixed(2)}`);

      return {
        success: true,
        data: {
          prices,
          results,
          count: results.length,
          provider: 'Kraken',
          timestamp: Date.now()
        },
        message: `Successfully fetched ${results.length} cryptocurrency prices from Kraken`
      };

    } catch (error) {
      console.error('[KRAKEN] Price fetch failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: 'Failed to fetch cryptocurrency prices from Kraken API'
      };
    }
  }
});

// Helper function to get specific ADA price (backward compatibility)
export async function getADAPriceFromKraken(): Promise<number> {
  try {
    const { RuntimeContext } = await import('@mastra/core/runtime-context');
    const result: any = await (krakenPriceTool as any).execute({
      context: { pairs: ['ADAUSD'] },
      runtimeContext: new RuntimeContext(),
    });
    
    if (result.success && result.data?.prices?.ADAUSD?.price) {
      return result.data.prices.ADAUSD.price;
    }
    
    console.warn('Failed to get ADA price from Kraken, using fallback $0.50');
    return 0.50;
  } catch (error) {
    console.warn('Failed to get ADA price from Kraken, using fallback $0.50');
    return 0.50;
  }
}
