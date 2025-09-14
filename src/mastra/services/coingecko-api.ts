// Minimal CoinGecko API client used by market-data tool
// Note: This is a lightweight implementation sufficient for typechecking and basic usage.

export interface CoinSearchResult {
  id: string;
  name: string;
  symbol: string;
}

export interface CoinDataResponse {
  id: string;
  name: string;
  symbol: string;
  description?: { en?: string };
  market_data?: any;
  last_updated?: string;
}

const BASE = 'https://api.coingecko.com/api/v3';

async function safeFetchJson(url: string) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`CoinGecko error ${res.status} ${res.statusText}`);
  return res.json();
}

export const coinGeckoAPI = {
  async searchCoins(query: string): Promise<CoinSearchResult[]> {
    if (!query || query.trim().length === 0) return [];
    try {
      const data = await safeFetchJson(
        `${BASE}/search?query=${encodeURIComponent(query)}`
      );
      const coins = Array.isArray(data?.coins) ? data.coins : [];
      return coins.map((c: any) => ({ id: c.id, name: c.name, symbol: c.symbol }));
    } catch {
      return [];
    }
  },

  async getCoinData(id: string): Promise<CoinDataResponse | null> {
    if (!id) return null;
    try {
      return await safeFetchJson(
        `${BASE}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&community_data=false&developer_data=false`
      );
    } catch {
      return null;
    }
  },
};

