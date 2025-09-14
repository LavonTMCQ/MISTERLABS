import 'dotenv/config';

const BASE = 'https://openapi.taptools.io/api/v1';
const KEY = process.env.TAPTOOLS_API_KEY;

if (!KEY) {
  console.error('Missing TAPTOOLS_API_KEY in environment');
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

async function main() {
  const pages = 5; // target ~500, API may return fewer
  const perPage = 100;
  const all = [];
  const seen = new Set();

  for (let p = 1; p <= pages; p++) {
    const data = await fetchPage(p, perPage, 'mcap');
    if (!Array.isArray(data) || data.length === 0) {
      console.log(`Page ${p} returned no data; stopping.`);
      break;
    }
    for (const t of data) {
      const unit = t.unit || (t.policyId ? (t.policyId + (t.assetName || '')) : undefined);
      const key = unit || `${t.ticker}:${t.mcap}:${t.price}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(t);
      }
    }
    console.log(`Fetched page ${p}: +${data.length}, total so far ${all.length}`);
    if (data.length < perPage) {
      console.log('Reached last page from API.');
      break;
    }
  }

  // Print summary and a small sample
  console.log(`\nTotal unique tokens fetched: ${all.length}`);
  console.log(all.slice(0, 5).map(t => ({ ticker: t.ticker, unit: t.unit, mcap: t.mcap, price: t.price })));
}

main().catch((e) => { console.error(e); process.exit(1); });

