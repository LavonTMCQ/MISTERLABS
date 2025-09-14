import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Client } from 'pg';

export const tokenDbStatsTool = createTool({
  id: 'token-db-stats',
  description: 'Returns token DB statistics: total tokens, latest update timestamp, token_history counts, and a sample of top tokens by market cap.',
  inputSchema: z.object({
    connectionString: z.string().optional().describe('PostgreSQL connection string. Defaults to process.env.DATABASE_URL'),
    sampleSize: z.number().optional().default(5).describe('Number of top tokens to sample by market cap'),
  }),
  execute: async ({ context }) => {
    const connectionString = context.connectionString || process.env.DATABASE_URL;
    if (!connectionString) {
      return { success: false, error: 'DATABASE_URL not configured and no connectionString provided.' };
    }

    const client = new Client({ connectionString });
    await client.connect();
    try {
      const total = await client.query('select count(*)::int as c from tokens');
      const latest = await client.query("select max(last_updated) as ts from tokens");
      const sample = await client.query(
        'select ticker, unit, market_cap, price_usd, volume_24h, last_updated from tokens order by market_cap desc nulls last limit $1',
        [context.sampleSize || 5],
      );
      const hist24h = await client.query(
        "select count(*)::int as c from token_history where captured_at > now() - interval '24 hours'",
      );
      const hist7d = await client.query(
        "select count(*)::int as c from token_history where captured_at > now() - interval '7 days'",
      );

      const latestTs = latest.rows[0]?.ts as Date | null;
      const latestIso = latestTs ? new Date(latestTs).toISOString() : null;
      const ageMinutes = latestTs ? Math.floor((Date.now() - new Date(latestTs).getTime()) / 60000) : null;

      return {
        success: true,
        database: connectionString.replace(/:[^:@/]+@/, ':***@'), // mask password in echoes
        totals: {
          tokens: total.rows[0]?.c ?? 0,
          history_last_24h: hist24h.rows[0]?.c ?? 0,
          history_last_7d: hist7d.rows[0]?.c ?? 0,
        },
        freshness: {
          latest_update_iso: latestIso,
          latest_age_minutes: ageMinutes,
          stale: ageMinutes != null ? ageMinutes > 360 : null, // > 6h considered stale
        },
        sample_top_by_mcap: sample.rows,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      await client.end();
    }
  },
});

