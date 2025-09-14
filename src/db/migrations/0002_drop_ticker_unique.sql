alter table if exists tokens drop constraint if exists tokens_ticker_key;
-- ensure non-unique index exists for case-insensitive lookups
create index if not exists idx_tokens_ticker on tokens (ticker);

