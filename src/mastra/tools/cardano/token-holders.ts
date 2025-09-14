import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { tapToolsAPI } from '../../services/taptools-api';
import { RuntimeContext } from '@mastra/core/runtime-context';

/**
 * Get top holders for a Cardano token
 * Shows holder distribution and whale concentration
 */
export const tokenHoldersTool = createTool({
  id: 'cardano-token-holders',
  description: 'Get top holders and distribution data for a Cardano token',
  inputSchema: z.object({
    token: z.string().describe('Token ticker symbol or policy ID'),
    limit: z.number().default(20).describe('Number of top holders to return'),
  }),
  execute: async ({ context: { token, limit } }) => {
    try {
      console.log(`👥 Fetching holders for: ${token}`);
      
      // Resolve token via DB-backed ticker tool (with TapTools fallback inside)
      let tokenData: any = null;
      let unit: string | null = null;
      if (/^[a-f0-9]{56,}$/i.test(token)) {
        // Provided as policyId/unit
        unit = token;
        tokenData = {
          ticker: token,
          name: 'Token',
          unit,
          policy_id: token.length === 56 ? token : token.substring(0, 56),
          decimals: 0,
        };
      } else {
        try {
          const mod: any = await import('./ticker-to-unit');
          const resolveResult: any = await (mod.tickerToUnitTool as any).execute({
            context: { ticker: token, searchLimit: 10 },
            runtimeContext: new RuntimeContext(),
          });
          if (resolveResult?.success && resolveResult.data?.unit) {
            unit = resolveResult.data.unit as string;
            tokenData = {
              ticker: resolveResult.data.ticker || token,
              name: resolveResult.data.name || 'Unknown',
              unit,
              policy_id: resolveResult.data.policy_id || resolveResult.data.policyId,
              decimals: resolveResult.data.decimals || 0,
              supply: resolveResult.data.supply || null,
            };
          }
        } catch {}
      }

      if (!tokenData || !unit) {
        return {
          success: false,
          error: 'Token not found',
          message: `Could not find token: ${token}`
        };
      }

      // Get holders from TapTools
      const holders = await tapToolsAPI.getTokenHolders(unit, limit);
      const totalHolders = await tapToolsAPI.getTotalHolders(unit);

      if (holders.length === 0) {
        return {
          success: false,
          message: `No holder data available for ${tokenData.name}`,
          token: {
            ticker: tokenData.ticker,
            name: tokenData.name
          }
        };
      }

      // Calculate holder metrics
      const supply = tokenData.supply || 1000000000; // Default 1B if not available
      const decimals = tokenData.decimals || 0;
      
      // Process holders with percentages
      const processedHolders = holders.map((holder, index) => {
        const amount = holder.amount / Math.pow(10, decimals);
        const percentage = (amount / (supply / Math.pow(10, decimals))) * 100;
        
        return {
          rank: index + 1,
          address: holder.address?.substring(0, 10) + '...' + holder.address?.substring(holder.address.length - 6),
          amount: amount.toLocaleString(),
          percentage: percentage.toFixed(2) + '%',
          isWhale: percentage > 1,
          isExchange: holder.address?.includes('exchange') || percentage > 5
        };
      });

      // Calculate concentration metrics
      const top10Percentage = processedHolders.slice(0, 10)
        .reduce((sum, h) => sum + parseFloat(h.percentage), 0);
      const top20Percentage = processedHolders
        .reduce((sum, h) => sum + parseFloat(h.percentage), 0);
      const whaleCount = processedHolders.filter(h => h.isWhale).length;

      // Determine distribution health
      let distributionHealth = 'Healthy';
      if (top10Percentage > 70) distributionHealth = 'Highly Concentrated';
      else if (top10Percentage > 50) distributionHealth = 'Moderately Concentrated';
      else if (top10Percentage < 30) distributionHealth = 'Well Distributed';

      return {
        success: true,
        token: {
          ticker: tokenData.ticker,
          name: tokenData.name,
          unit: tokenData.unit,
          supply: (supply / Math.pow(10, decimals)).toLocaleString()
        },
        metrics: {
          totalHolders: totalHolders || holders.length * 5, // Estimate if not available
          uniqueHolders: totalHolders || holders.length * 5,
          top10Concentration: top10Percentage.toFixed(2) + '%',
          top20Concentration: top20Percentage.toFixed(2) + '%',
          whaleCount,
          distributionHealth,
          decentralizationScore: Math.max(0, 100 - top10Percentage).toFixed(0)
        },
        topHolders: processedHolders.slice(0, 10),
        analysis: {
          riskLevel: top10Percentage > 60 ? 'High' : top10Percentage > 40 ? 'Medium' : 'Low',
          recommendation: top10Percentage > 60 
            ? 'High concentration risk - whales could dump'
            : top10Percentage > 40 
            ? 'Moderate concentration - monitor whale movements'
            : 'Healthy distribution - lower manipulation risk'
        },
        message: `Found ${totalHolders || holders.length} holders for ${tokenData.name}`
      };

    } catch (error) {
      console.error(`❌ Failed to fetch holders for ${token}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: `Failed to fetch holder data for: ${token}`
      };
    }
  },
});
