import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { tapToolsAPI } from '../../services/taptools-api';
import { tokenLookupService } from '../../services/token-lookup';

/**
 * Get recent trades for a Cardano token
 * Shows actual market activity and trade flow
 */
export const tokenTradesTool = createTool({
  id: 'cardano-token-trades',
  description: 'Get recent trades for a Cardano token from TapTools API',
  inputSchema: z.object({
    token: z.string().describe('Token ticker symbol or policy ID'),
    timeframe: z.string().default('24h').describe('Timeframe for trades (1h, 6h, 24h, 7d)'),
    minAmount: z.number().optional().describe('Minimum trade amount in ADA'),
    limit: z.number().default(20).describe('Number of trades to return'),
  }),
  execute: async ({ context: { token, timeframe, minAmount, limit } }) => {
    try {
      console.log(`📊 Fetching trades for: ${token} (${timeframe})`);
      
      // Resolve token
      const tokenData = await tokenLookupService.resolveToken(token);
      if (!tokenData || !tokenData.unit) {
        return {
          success: false,
          error: 'Token not found',
          message: `Could not find token: ${token}`
        };
      }

      // Get trades from TapTools
      const trades = await tapToolsAPI.getTokenTrades(tokenData.unit, {
        timeframe,
        minAmount,
        perPage: limit,
        sortBy: 'time',
        order: 'desc'
      });

      if (trades.length === 0) {
        return {
          success: false,
          message: `No recent trades found for ${tokenData.name}`,
          token: {
            ticker: tokenData.ticker,
            name: tokenData.name
          }
        };
      }

      // Process trades for better formatting
      const processedTrades = trades.map(trade => ({
        time: new Date(trade.time * 1000).toLocaleString(),
        type: trade.type || 'swap',
        amount: trade.amount,
        price: trade.price,
        value: trade.value || (trade.amount * trade.price),
        dex: trade.dex || 'Unknown',
        txHash: trade.tx_hash
      }));

      // Calculate summary stats
      const totalVolume = processedTrades.reduce((sum, t) => sum + (t.value || 0), 0);
      const avgPrice = processedTrades.reduce((sum, t) => sum + (t.price || 0), 0) / processedTrades.length;
      const buyCount = processedTrades.filter(t => t.type === 'buy').length;
      const sellCount = processedTrades.filter(t => t.type === 'sell').length;

      return {
        success: true,
        token: {
          ticker: tokenData.ticker,
          name: tokenData.name,
          unit: tokenData.unit
        },
        summary: {
          totalTrades: trades.length,
          timeframe,
          totalVolume: totalVolume.toFixed(2),
          averagePrice: avgPrice.toFixed(8),
          buyPressure: buyCount > sellCount ? 'Bullish' : 'Bearish',
          buys: buyCount,
          sells: sellCount
        },
        trades: processedTrades.slice(0, 10), // Top 10 most recent
        message: `Found ${trades.length} trades for ${tokenData.name} in ${timeframe}`
      };

    } catch (error) {
      console.error(`❌ Failed to fetch trades for ${token}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: `Failed to fetch trades for: ${token}`
      };
    }
  },
});