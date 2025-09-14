create table if not exists token_history (
  id bigserial primary key,
  unit text not null,
  captured_at timestamptz not null default now(),
  ticker text,
  name text,
  price_usd numeric,
  volume_24h numeric,
  market_cap numeric,
  supply numeric,
  source text default 'taptools'
);

create index if not exists idx_token_history_unit on token_history(unit);
create index if not exists idx_token_history_captured_at on token_history(captured_at desc);

