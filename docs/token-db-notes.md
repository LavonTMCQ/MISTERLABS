# Token DB Notes (Architecture & Ops)

## Purpose
- Single source of truth for Cardano tokens keyed by `unit` (`policy_id + asset_name`).
- Fast lookup for `$TICKER → unit`, then always fetch fresh prices via TapTools using the `unit`.
- Maintain timestamps for freshness checks and time-series in `token_history`.

## Data Sources (TapTools)
- Top Market Cap: `GET /token/top/mcap` (pages of 100).
- Top Volume: `GET /token/top/volume` (timeframe default `24h`, pages of 100).
- We fetch up to 5 pages per source (configurable), dedupe by `unit`, then keep top by `market_cap` (fallback by `volume_24h`) up to a cap (default 500).

## Schema
- `tokens(unit primary key, ticker unique? → removed, name, policy_id, asset_name, decimals, price_usd, volume_24h, market_cap, supply, last_updated)`
- `token_history(id, unit, captured_at, ticker, name, price_usd, volume_24h, market_cap, supply, source)`
- Indexes: `lower(ticker)`, `lower(name)`, `token_history(unit)`, `token_history(captured_at desc)`

## Tools & Scripts
- Lookup: `src/mastra/tools/ticker-to-unit.ts` (uses Postgres repository; no SQLite; TapTools fallback only if DB miss)
- DB Stats: `src/mastra/tools/database/token-db-stats.ts` (totals, freshness, sample)
- Sync script: `scripts/sync-tokens.mjs` (mcap + volume, dedupe, upsert, history, cap to 500)
- Verify: `scripts/verify-top-mcap.mjs`
- Migrations: `src/db/migrations/` (0001 tokens, 0002 drop ticker unique, 0003 token_history)

## Scheduler
- Run `node scripts/sync-tokens.mjs` every 6 hours (Railway Job cron: `0 */6 * * *`).
- Env:
  - `TAPTOOLS_API_KEY` (required)
  - `DATABASE_URL` (required)
  - `TOKEN_DISCOVERY_SOURCES=mcap,volume`
  - `TOKEN_DISCOVERY_PAGES=5`
  - `TOKEN_DB_CAP=500`
  - `TOKEN_VOLUME_TIMEFRAME=24h`

## Agent Guidance
- Home DB: `DATABASE_URL` in `.env` (used by agents).
- Use DB for `$TICKER → unit` and metadata; never use DB prices in answers.
- For fresh prices and charts, pass `unit` to TapTools tools.
- Check staleness with `token-db-stats` (latest `last_updated`, and `captured_at` in history).

## Notes
- Tickers aren’t globally unique on Cardano; unique constraint removed.
- Serverless-safe: short-lived Postgres clients; no global handles.
- Safe reruns: upserts are idempotent; trimming enforces cap.
