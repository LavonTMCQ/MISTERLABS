-- Tokens canonical table
create table if not exists tokens (
  unit text primary key,
  ticker text unique,
  name text,
  policy_id text not null,
  asset_name text,
  decimals integer,
  price_usd numeric,
  volume_24h numeric,
  market_cap numeric,
  supply numeric,
  last_updated timestamptz default now()
);

-- Fast lookup by ticker
create index if not exists idx_tokens_lower_ticker on tokens (lower(ticker));
create index if not exists idx_tokens_lower_name on tokens (lower(name));

