import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const BASE = 'https://openapi.taptools.io/api/v1';
const KEY = process.env.TAPTOOLS_API_KEY;
const DB_URL = process.env.DATABASE_URL;

if (!KEY) {
  console.error('Missing TAPTOOLS_API_KEY in environment');
  process.exit(1);
}
if (!DB_URL) {
  console.error('Missing DATABASE_URL in environment');
  process.exit(1);
}

async function fetchPage(page, perPage = 100, type = 'mcap') {
  const url = new URL(BASE + '/token/top/mcap');
  url.searchParams.set('type', type);
  url.searchParams.set('page', String(page));
  url.searchParams.set('perPage', String(perPage));
  const resp = await fetch(url.toString(), {
    headers: { 'x-api-key': KEY, 'Accept': 'application/json' },
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`TapTools error ${resp.status}: ${txt}`);
  }
  return resp.json();
}

function splitUnit(unit) {
  // policy_id usually 56 hex chars; asset_name is the remainder (may be empty)
  if (!unit || typeof unit !== 'string') return { policy_id: null, asset_name: null };
  if (unit === 'lovelace') return { policy_id: 'lovelace', asset_name: '' };
  const policy_id = unit.slice(0, 56);
  const asset_name = unit.slice(56) || null;
  return { policy_id, asset_name };
}

async function upsertTokens(tokens) {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query('begin');
    let added = 0, updated = 0;
    for (const t of tokens) {
      const unit = t.unit || (t.policyId ? (t.policyId + (t.assetName || '')) : null);
      if (!unit) continue;
      const { policy_id, asset_name } = splitUnit(unit);
      const ticker = t.ticker || null;
      const name = t.name || t.ticker || null;
      const decimals = Number.isFinite(t.decimals) ? t.decimals : null;
      const price_usd = Number.isFinite(t.price) ? t.price : null;
      const market_cap = Number.isFinite(t.mcap) ? t.mcap : null;
      const supply = Number.isFinite(t.totalSupply) ? t.totalSupply : null;
      const volume_24h = Number.isFinite(t.volume) ? t.volume : null;

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
        [unit, ticker, name, policy_id, asset_name, decimals, price_usd, volume_24h, market_cap, supply]
      );
      if (res.rows[0]?.inserted) added++; else updated++;
    }
    await client.query('commit');
    return { added, updated };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    await client.end();
  }
}

async function main() {
  const pages = 5;
  const perPage = 100;
  const all = [];
  for (let p = 1; p <= pages; p++) {
    const data = await fetchPage(p, perPage, 'mcap');
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    console.log(`Fetched page ${p}: ${data.length}`);
    if (data.length < perPage) break;
  }
  console.log(`Total fetched: ${all.length}`);
  const result = await upsertTokens(all);
  console.log('Upsert result:', result);
}

main().catch((e) => { console.error(e); process.exit(1); });

