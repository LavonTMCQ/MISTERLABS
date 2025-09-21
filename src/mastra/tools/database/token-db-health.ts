import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Client } from 'pg';

export const tokenDbHealthTool = createTool({
  id: 'token-db-health',
  description: 'Lightweight health check for the token database: totals, latest update timestamp, freshness flag.',
  inputSchema: z.object({
    connectionString: z.string().optional().describe('PostgreSQL connection string. Defaults to process.env.DATABASE_URL'),
    staleAfterMinutes: z.number().optional().default(360).describe('Threshold in minutes to consider DB stale (default: 6h)'),
  }),
  execute: async ({ context }) => {
    const connectionString = context.connectionString || process.env.DATABASE_URL;
    if (!connectionString) {
      return { success: false, error: 'DATABASE_URL not configured and no connectionString provided.' };
    }

    const client = new Client({ connectionString });
    await client.connect();
    try {
      const totalRes = await client.query('select count(*)::int as c from tokens');
      const latestRes = await client.query("select max(last_updated) as ts from tokens");

      const latestTs = latestRes.rows[0]?.ts as Date | null;
      const latestIso = latestTs ? new Date(latestTs).toISOString() : null;
      const ageMinutes = latestTs ? Math.floor((Date.now() - new Date(latestTs).getTime()) / 60000) : null;
      const staleAfter = context.staleAfterMinutes ?? 360;

      return {
        success: true,
        database: connectionString.replace(/:[^:@/]+@/, ':***@'),
        totals: { tokens: totalRes.rows[0]?.c ?? 0 },
        freshness: {
          latest_update_iso: latestIso,
          latest_age_minutes: ageMinutes,
          stale: ageMinutes != null ? ageMinutes > staleAfter : null,
          threshold_minutes: staleAfter,
        },
      };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    } finally {
      await client.end();
    }
  },
});

