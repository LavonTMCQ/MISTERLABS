import { Client } from 'pg';

export interface TokenRecord {
  unit: string;
  ticker?: string | null;
  name?: string | null;
  policy_id: string;
  asset_name?: string | null;
  decimals?: number | null;
  price_usd?: number | null;
  volume_24h?: number | null;
  market_cap?: number | null;
  supply?: number | null;
  last_updated?: string | null;
}

export interface TokenRepository {
  getByTicker(ticker: string): Promise<TokenRecord | null>;
  search(query: string, limit?: number): Promise<TokenRecord[]>;
  upsertMany(tokens: TokenRecord[]): Promise<{ added: number; updated: number }>;
  stats(): Promise<{ totalTokens: number; lastUpdated: string | null }>;
}

function getDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for token repository');
  return url;
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: getDbUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export class PgTokenRepository implements TokenRepository {
  async getByTicker(ticker: string): Promise<TokenRecord | null> {
    return withClient(async (client) => {
      const { rows } = await client.query(
        `select unit, ticker, name, policy_id, asset_name, decimals,
                price_usd, volume_24h, market_cap, supply,
                to_char(last_updated at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_updated
         from tokens
         where lower(ticker) = lower($1)
         order by volume_24h desc nulls last, market_cap desc nulls last
         limit 1`,
        [ticker]
      );
      return rows[0] || null;
    });
  }

  async search(query: string, limit = 10): Promise<TokenRecord[]> {
    const q = query.trim();
    if (!q) return [];
    return withClient(async (client) => {
      const { rows } = await client.query(
        `select unit, ticker, name, policy_id, asset_name, decimals,
                price_usd, volume_24h, market_cap, supply,
                to_char(last_updated at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_updated
         from tokens
         where lower(ticker) like lower($1) or lower(name) like lower($1)
         order by volume_24h desc nulls last, market_cap desc nulls last
         limit $2`,
        ['%' + q + '%', Math.max(1, Math.min(100, limit))]
      );
      return rows;
    });
  }

  async upsertMany(tokens: TokenRecord[]): Promise<{ added: number; updated: number }> {
    if (tokens.length === 0) return { added: 0, updated: 0 };
    return withClient(async (client) => {
      await client.query('begin');
      try {
        let added = 0;
        let updated = 0;
        for (const t of tokens) {
          const res = await client.query(
            `insert into tokens (unit, ticker, name, policy_id, asset_name, decimals, price_usd, volume_24h, market_cap, supply, last_updated)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
             on conflict (unit) do update set
               ticker = excluded.ticker,
               name = excluded.name,
               policy_id = excluded.policy_id,
               asset_name = excluded.asset_name,
               decimals = excluded.decimals,
               price_usd = excluded.price_usd,
               volume_24h = excluded.volume_24h,
               market_cap = excluded.market_cap,
               supply = excluded.supply,
               last_updated = now()
             returning (xmax = 0) as inserted`,
            [
              t.unit,
              t.ticker ?? null,
              t.name ?? null,
              t.policy_id,
              t.asset_name ?? null,
              t.decimals ?? null,
              t.price_usd ?? null,
              t.volume_24h ?? null,
              t.market_cap ?? null,
              t.supply ?? null,
            ]
          );
          if (res.rows[0]?.inserted) added++; else updated++;
        }
        await client.query('commit');
        return { added, updated };
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    });
  }

  async stats(): Promise<{ totalTokens: number; lastUpdated: string | null }> {
    return withClient(async (client) => {
      const total = await client.query('select count(*)::int as c from tokens');
      const last = await client.query(
        `select to_char(max(last_updated) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ts from tokens`
      );
      return { totalTokens: total.rows[0]?.c ?? 0, lastUpdated: last.rows[0]?.ts ?? null };
    });
  }
}

export function getTokenRepository(): TokenRepository {
  // For now, only Postgres is supported in cloud; add LibSQL later if needed
  return new PgTokenRepository();
}

