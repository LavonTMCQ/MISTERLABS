// Compatibility shim for legacy token-database-manager-sqlite
// Implements a minimal in-memory interface expected by token-lookup-tool.ts

type LegacyToken = {
  unit: string;
  ticker: string;
  name: string;
  marketCap?: number;
  price?: number;
  volume24h?: number;
  volume7d?: number;
  holders?: number;
  priceChange24h?: number;
  priceChange7d?: number;
  lastUpdated?: string;
};

const byUnit = new Map<string, LegacyToken>();
const byTicker = new Map<string, LegacyToken>();

function put(token: LegacyToken): LegacyToken {
  const t = {
    ...token,
    lastUpdated: token.lastUpdated || new Date().toISOString(),
  };
  byUnit.set(t.unit, t);
  byTicker.set(t.ticker.toUpperCase(), t);
  return t;
}

// Preload a few well-known tokens so legacy lookups don’t crash
put({
  ticker: 'MISTER',
  name: 'MISTER',
  unit: '3fb8848b96db9b5e223b789b57926d2ca5db23e32e09e838e0ad02984d4953544552',
  marketCap: 0,
  price: 0,
  volume24h: 0,
});
put({
  ticker: 'SNEK',
  name: 'Snek',
  unit: '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b',
  marketCap: 0,
  price: 0,
  volume24h: 0,
});
put({
  ticker: 'HOSKY',
  name: 'Hosky Token',
  unit: 'a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59',
  marketCap: 0,
  price: 0,
  volume24h: 0,
});

export const tokenDatabase = {
  getTokenByTicker(ticker: string): LegacyToken | null {
    return byTicker.get((ticker || '').toUpperCase()) || null;
  },
  getToken(unitOrKey: string): LegacyToken | null {
    if (!unitOrKey) return null;
    if (unitOrKey.length >= 56) return byUnit.get(unitOrKey) || null;
    return byTicker.get(unitOrKey.toUpperCase()) || null;
  },
  upsertToken(token: LegacyToken): LegacyToken {
    return put(token);
  },
  searchTokens(opts: { limit?: number } = {}): LegacyToken[] {
    const limit = Math.max(1, Math.min(100, opts.limit ?? 10));
    return Array.from(byTicker.values()).slice(0, limit);
  },
};

