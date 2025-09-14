# Railway Cron Setup (Token Sync)

This project includes a script that fetches Cardano top tokens by market cap and volume from TapTools, upserts them into Postgres, caps the DB at 500 tokens, and writes timestamped history.

Command to run
- `node scripts/sync-tokens.mjs`
- Uses env:
  - `TAPTOOLS_API_KEY` (required)
  - `DATABASE_URL` (required)
  - `TOKEN_DISCOVERY_SOURCES` (default `mcap,volume`)
  - `TOKEN_DISCOVERY_PAGES` (default `5`)
  - `TOKEN_DB_CAP` (default `500`)
  - `TOKEN_VOLUME_TIMEFRAME` (default `24h`)

Schedule on Railway (UI)
1. Open your Railway project → New → Job (or Schedules).
2. Command: `node scripts/sync-tokens.mjs`
3. Schedule (cron): `0 */6 * * *` (every 6 hours)
4. Set variables on the Job:
   - `TAPTOOLS_API_KEY` (same as app)
   - `DATABASE_URL` (your Postgres URL)
   - Optional tuning: `TOKEN_DISCOVERY_SOURCES=mcap,volume`, `TOKEN_DISCOVERY_PAGES=5`, `TOKEN_DB_CAP=500`
5. Save. Railway runs the job on schedule.

Notes
- API calls/run: 5 (mcap) + 5 (volume) = 10 → 40/day at 6h interval.
- DB tables used: `tokens` (last_updated) and `token_history` (captured_at for time-series).
- Safe to re-run; upserts are idempotent, de-dup by `unit`.

