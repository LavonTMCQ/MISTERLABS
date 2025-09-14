import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const BASE = 'https://openapi.taptools.io/api/v1';
const KEY = process.env.TAPTOOLS_API_KEY;
const DB_URL = process.env.DATABASE_URL;
const SOURCES = (process.env.TOKEN_DISCOVERY_SOURCES || 'mcap,volume').split(',').map(s => s.trim()).filter(Boolean);
const PAGES = Number(process.env.TOKEN_DISCOVERY_PAGES || 5);
const CAP = Number(process.env.TOKEN_DB_CAP || 500);
const VOLUME_TIMEFRAME = process.env.TOKEN_VOLUME_TIMEFRAME || '24h';

if (!KEY) { console.error('Missing TAPTOOLS_API_KEY'); process.exit(1); }
if (!DB_URL) { console.error('Missing DATABASE_URL'); process.exit(1); }

async function fetchTopMcap(page, perPage = 100) {
  const url = new URL(BASE + '/token/top/mcap');
  url.searchParams.set('type', 'mcap');
  url.searchParams.set('page', String(page));
  url.searchParams.set('perPage', String(perPage));
  const resp = await fetch(url.toString(), { headers: { 'x-api-key': KEY, 'Accept': 'application/json' } });
  if (!resp.ok) throw new Error(`TapTools mcap ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function fetchTopVolume(page, perPage = 100, timeframe = VOLUME_TIMEFRAME) {
  const url = new URL(BASE + '/token/top/volume');
  url.searchParams.set('timeframe', timeframe);
  url.searchParams.set('page', String(page));
  url.searchParams.set('perPage', String(perPage));
  const resp = await fetch(url.toString(), { headers: { 'x-api-key': KEY, 'Accept': 'application/json' } });
  if (!resp.ok) throw new Error(`TapTools volume ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

function splitUnit(unit) {
  if (!unit || typeof unit !== 'string') return { policy_id: null, asset_name: null };
  if (unit === 'lovelace') return { policy_id: 'lovelace', asset_name: '' };
  const policy_id = unit.slice(0, 56);
  const asset_name = unit.slice(56) || null;
  return { policy_id, asset_name };
}

function normalizeToken(raw, source) {
  const unit = raw.unit || (raw.policyId ? (raw.policyId + (raw.assetName || '')) : null);
  const { policy_id, asset_name } = splitUnit(unit);
  return {
    unit,
    ticker: raw.ticker || null,
    name: raw.name || raw.ticker || null,
    policy_id,
    asset_name,
    decimals: Number.isFinite(raw.decimals) ? raw.decimals : null,
    price_usd: Number.isFinite(raw.price) ? raw.price : null,
    volume_24h: Number.isFinite(raw.volume) ? raw.volume : null,
    market_cap: Number.isFinite(raw.mcap) ? raw.mcap : null,
    supply: Number.isFinite(raw.totalSupply) ? raw.totalSupply : null,
    source,
  };
}

async function upsertTokens(client, tokens) {
  let added = 0, updated = 0;
  for (const t of tokens) {
    if (!t.unit) continue;
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
      [t.unit, t.ticker, t.name, t.policy_id, t.asset_name, t.decimals, t.price_usd, t.volume_24h, t.market_cap, t.supply]
    );
    if (res.rows[0]?.inserted) added++; else updated++;
    // Write to history
    await client.query(
      `insert into token_history (unit, ticker, name, price_usd, volume_24h, market_cap, supply, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [t.unit, t.ticker, t.name, t.price_usd, t.volume_24h, t.market_cap, t.supply, t.source]
    );
  }
  return { added, updated };
}

function selectTopCap(unionMap, cap) {
  // Convert to array and rank by market_cap desc, fallback to volume desc
  const arr = Array.from(unionMap.values());
  arr.sort((a, b) => {
    const am = a.market_cap ?? -1; const bm = b.market_cap ?? -1;
    if (bm !== am) return bm - am;
    const av = a.volume_24h ?? -1; const bv = b.volume_24h ?? -1;
    return bv - av;
  });
  return arr.slice(0, cap);
}

async function trimToCap(client, keepUnits) {
  const set = new Set(keepUnits);
  await client.query(`delete from tokens where unit not in (${keepUnits.map((_, i) => `$${i+1}`).join(',')})`, keepUnits);
}

async function main() {
  const perPage = 100;
  const union = new Map(); // unit -> normalized token

  // MCAP
  if (SOURCES.includes('mcap')) {
    for (let p = 1; p <= PAGES; p++) {
      const data = await fetchTopMcap(p, perPage);
      if (!Array.isArray(data) || data.length === 0) break;
      for (const raw of data) {
        const t = normalizeToken(raw, 'mcap');
        if (t.unit && !union.has(t.unit)) union.set(t.unit, t);
        else if (t.unit) {
          // Merge better metrics if present
          const prev = union.get(t.unit);
          union.set(t.unit, { ...prev, ...t, price_usd: t.price_usd ?? prev.price_usd, market_cap: t.market_cap ?? prev.market_cap });
        }
      }
      if (data.length < perPage) break;
    }
  }

  // VOLUME
  if (SOURCES.includes('volume')) {
    for (let p = 1; p <= PAGES; p++) {
      const data = await fetchTopVolume(p, perPage, VOLUME_TIMEFRAME);
      if (!Array.isArray(data) || data.length === 0) break;
      for (const raw of data) {
        const t = normalizeToken(raw, 'volume');
        if (t.unit && !union.has(t.unit)) union.set(t.unit, t);
        else if (t.unit) {
          const prev = union.get(t.unit);
          union.set(t.unit, { ...prev, ...t, volume_24h: t.volume_24h ?? prev.volume_24h });
        }
      }
      if (data.length < perPage) break;
    }
  }

  const selected = selectTopCap(union, CAP);
  console.log(`Selected ${selected.length} tokens for cap ${CAP} from union size ${union.size}`);

  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query('begin');
    const res = await upsertTokens(client, selected);
    await client.query('commit');
    console.log('Upsert:', res);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    await client.end();
  }

  // Trim outside transaction to keep it simple
  const client2 = new Client({ connectionString: DB_URL });
  await client2.connect();
  try {
    if (selected.length > 0) {
      await trimToCap(client2, selected.map(t => t.unit));
      console.log('Trimmed to cap:', CAP);
    }
  } finally {
    await client2.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

