import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getTokenRepository } from '../../../db/token-repository';

/**
 * Comprehensive token search using our unified token DB.
 * Falls back to DB partial matches to support ticker/name queries.
 * Returned tokens include unit, policyId, assetName for downstream TapTools usage.
 */
export const comprehensiveTokenSearchTool = createTool({
  id: 'comprehensive-token-search',
  description: 'Search Cardano tokens by ticker or name in the unified token database and return identifiers for live pricing (unit, policy_id, asset_name).',
  inputSchema: z.object({
    query: z.string().describe('Ticker or name to search for'),
    maxResults: z.number().optional().default(10).describe('Maximum results to return'),
  }),
  execute: async ({ context }) => {
    const { query, maxResults = 10 } = context;
    try {
      const repo = getTokenRepository();
      const results = await repo.search(query, maxResults);

      const tokens = results.map((r) => ({
        ticker: r.ticker || null,
        name: r.name || null,
        policyId: r.policy_id,
        policy_id: r.policy_id,
        assetName: r.asset_name || null,
        asset_name: r.asset_name || null,
        unit: r.unit || `${r.policy_id}${r.asset_name ?? ''}`,
        decimals: r.decimals ?? 6,
        supply: r.supply ?? null,
        price: r.price_usd ?? null,
        mcap: r.market_cap ?? null,
        volume: r.volume_24h ?? null,
        lastUpdated: r.last_updated || null,
        source: 'database',
      }));

      return {
        success: true,
        data: { tokens },
        count: tokens.length,
        message: `Found ${tokens.length} result(s) for '${query}' in token DB`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to search tokens',
      };
    }
  },
});

