import { getTokenRepository } from '../../db/token-repository';

export interface ResolvedToken {
  ticker?: string | null;
  name?: string | null;
  unit: string;
  policy_id: string;
  asset_name?: string | null;
  // Optional market fields for compatibility with existing tools
  market_cap?: number | null;
  price?: number | null;
  volume_24h?: number | null;
  supply?: number | null;
}

class TokenLookupService {
  async resolveToken(query: string): Promise<ResolvedToken | null> {
    const repo = getTokenRepository();
    // If query looks like a full unit/policy, return directly
    if (query && query.length >= 56 && /^[0-9a-fA-F]+$/.test(query)) {
      // Try to find in DB, otherwise return minimal
      const results = await repo.search(query, 1);
      const r = results[0];
      if (r) {
        return {
          ticker: r.ticker ?? null,
          name: r.name ?? null,
          unit: r.unit || `${r.policy_id}${r.asset_name ?? ''}`,
          policy_id: r.policy_id,
          asset_name: r.asset_name ?? null,
        };
      }
      return { unit: query, policy_id: query.slice(0, 56), asset_name: query.slice(56) } as ResolvedToken;
    }

    // Otherwise treat as ticker/name
    const r = await repo.getByTicker(query);
    if (!r) return null;
    return {
      ticker: r.ticker ?? null,
      name: r.name ?? null,
      unit: r.unit || `${r.policy_id}${r.asset_name ?? ''}`,
      policy_id: r.policy_id,
      asset_name: r.asset_name ?? null,
    };
  }

  async getTokenUnit(ticker: string): Promise<string | null> {
    const r = await getTokenRepository().getByTicker(ticker);
    return r ? r.unit || `${r.policy_id}${r.asset_name ?? ''}` : null;
  }
}

export const tokenLookupService = new TokenLookupService();
