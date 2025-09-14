import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getTokenRepository } from '../../db/token-repository';

export const tickerToUnitTool = createTool({
  id: 'ticker-to-unit',
  description:
    'Resolve Cardano token unit/policy_id from the unified token database. Use unit with TapTools for fresh prices; DB price fields are informational only.',
  inputSchema: z.object({
    ticker: z.string().describe('Token ticker symbol (e.g., SNEK, HOSKY, MISTER, etc.)'),
    searchLimit: z.number().optional().describe('Maximum number of search results to return'),
  }),
  execute: async ({ context: { ticker, searchLimit = 10 } }) => {
    try {
      console.log(`🔍 [TICKER-TO-UNIT] Lookup for ticker: ${ticker}`);

      // 1) Primary: repository-backed DB lookup (Postgres in serverless)
      const repo = getTokenRepository();
      const dbHit = await repo.getByTicker(ticker);
      const databaseResults: any[] = dbHit ? [dbHit] : [];

      // 2) Fallback: hardcoded quick wins
      const hardcodedTokens = getHardcodedTokens();
      const hardcodedMatches = hardcodedTokens.filter(
        (token) =>
          token.ticker.toLowerCase() === ticker.toLowerCase() ||
          token.name.toLowerCase() === ticker.toLowerCase(),
      );

      // 3) Combine
      const allResults: any[] = [];

      if (databaseResults.length > 0) {
        databaseResults.forEach((token) => {
          allResults.push({
            ticker: token.ticker,
            name: token.name,
            policyId: token.policy_id,
            policy_id: token.policy_id,
            unit: token.unit || `${token.policy_id}${token.asset_name ?? ''}`,
            assetName: token.asset_name,
            asset_name: token.asset_name,
            source: 'database',
            confidence: 'high',
            note: 'Use unit with TapTools for fresh prices',
          });
        });
      }

      if (hardcodedMatches.length > 0) {
        hardcodedMatches.forEach((token) => {
          const existingMatch = allResults.find((r) => r.policyId === token.policyId);
          if (!existingMatch) {
            allResults.push({
              ticker: token.ticker,
              name: token.name,
              policyId: token.policyId,
              unit: token.unit,
              description: token.description,
              source: 'hardcoded',
              confidence: 'low',
            });
          }
        });
      }

      // 4) Fallback to database partial search (Cardano-only)
      if (allResults.length === 0) {
        console.log(`🔍 No exact DB result for ${ticker}, trying partial DB search...`);
        try {
          const limit = Math.max(1, Math.min(20, searchLimit));
          const repo = getTokenRepository();
          const partials = await repo.search(ticker, limit);
          if (partials && partials.length > 0) {
            partials.forEach((token) => {
              allResults.push({
                ticker: token.ticker || ticker,
                name: token.name || 'Unknown',
                policyId: token.policy_id,
                policy_id: token.policy_id,
                unit: token.unit || `${token.policy_id}${token.asset_name ?? ''}`,
                assetName: token.asset_name,
                asset_name: token.asset_name,
                supply: token.supply ?? null,
                decimals: token.decimals ?? 6,
                source: 'database',
                confidence: 'medium',
                marketCap: token.market_cap ?? null,
                priceUsd: token.price_usd ?? null,
                volume24h: token.volume_24h ?? null,
                lastUpdated: token.last_updated ?? null,
              });
            });
            console.log(`✅ Found ${partials.length} partial match(es) in token DB`);
          }
        } catch (searchError) {
          console.warn(`⚠️ Partial DB search failed:`, searchError);
        }

        if (allResults.length === 0) {
          return {
            success: false,
            error: `Ticker '${ticker}' not found in database or TapTools API`,
            message:
              `Token ${ticker} not found anywhere. It may not exist or the ticker might be incorrect.`,
            suggestions: [
              'Check if the ticker spelling is correct',
              'Try searching by token name instead',
              'The token might not exist on Cardano',
            ],
          };
        }
      }

      // 5) Rank
      allResults.sort((a, b) => {
        const confidenceOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
        return (confidenceOrder[b.confidence] || 0) - (confidenceOrder[a.confidence] || 0);
      });

      const primaryResult = allResults[0];
      const alternativeResults = allResults.slice(1);

      return {
        success: true,
        data: {
          ticker: primaryResult.ticker,
          name: primaryResult.name,
          policy_id: primaryResult.policyId || primaryResult.policy_id,
          policyId: primaryResult.policyId || primaryResult.policy_id,
          unit: primaryResult.unit,
          asset_name: primaryResult.assetName || primaryResult.asset_name,
          assetName: primaryResult.assetName || primaryResult.asset_name,
          marketCap: primaryResult.marketCap,
          priceUsd: primaryResult.priceUsd,
          volume24h: primaryResult.volume24h,
          lastUpdated: primaryResult.lastUpdated,
          supply: primaryResult.supply,
          decimals: primaryResult.decimals,
          source: primaryResult.source,
          confidence: primaryResult.confidence,
          totalResults: allResults.length,
          searchSources: [
            databaseResults.length > 0 ? 'Database (exact)' : null,
            hardcodedMatches.length > 0 ? 'Hardcoded fallback' : null,
            allResults.length > databaseResults.length + hardcodedMatches.length ? 'Database (partial)' : null,
          ].filter(Boolean),
          alternativeMatches: alternativeResults.map((r) => ({
            ticker: r.ticker,
            name: r.name,
            policyId: r.policyId,
            unit: r.unit,
            source: r.source,
            confidence: r.confidence,
          })),
        },
        message: `Found ${allResults.length} result(s) for ticker ${ticker}: ${primaryResult.name} (${primaryResult.source})`,
      };
    } catch (error) {
      console.error(`❌ Failed to lookup ticker ${ticker}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: `Failed to lookup ticker ${ticker}. Please try again or contact support.`,
      };
    }
  },
});

// Hardcoded tokens for fallback (from tokens.json)
function getHardcodedTokens() {
  return [
    {
      ticker: 'ADA',
      name: 'Cardano',
      policyId: 'lovelace',
      unit: 'lovelace',
      description: 'Native cryptocurrency of the Cardano blockchain',
    },
    {
      ticker: 'MISTER',
      name: 'MISTER',
      policyId: '3fb8848b96db9b5e223b789b57926d2ca5db23e32e09e838e0ad0298',
      unit:
        '3fb8848b96db9b5e223b789b57926d2ca5db23e32e09e838e0ad02984d4953544552',
      description:
        'MISTER - Market Intelligence System for Token Evaluation and Research',
    },
    {
      ticker: 'SNEK',
      name: 'Snek',
      policyId: '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f',
      unit: '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b',
      description: 'First Cardano memecoin listed on Kraken exchange',
    },
    {
      ticker: 'HOSKY',
      name: 'Hosky Token',
      policyId: 'a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235',
      unit: 'a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59',
      description: 'Popular Cardano memecoin with strong community following',
    },
    {
      ticker: 'AGENT',
      name: 'Agent Token',
      policyId: '97bbb7db0baef89caefce61b8107ac74c7a7340166b39d906f174bec',
      unit: '97bbb7db0baef89caefce61b8107ac74c7a7340166b39d906f174bec4147454e54',
      description: 'AI Agent token on Cardano',
    },
    {
      ticker: 'CHAD',
      name: 'Chad',
      policyId: '5b34c6b3e76a6366c848933f5a44bf2a23ad27a05b55109c5a4b111e',
      unit: '5b34c6b3e76a6366c848933f5a44bf2a23ad27a05b55109c5a4b111e43484144',
      description: 'Chad memecoin on Cardano',
    },
  ];
}
