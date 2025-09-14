# Agent Notes (Working Memory, Routing, and RAG)

## What We Changed
- Switched all agents to model `openai/gpt-5-nano-2025-08-07` via OpenAI SDK with OpenRouter base (V1 streaming compatible).
- Fixed Cardano routing rules:
  - Use `CardanoTopVolume` for “top volume” (map today→'24h', week→'7d', month→'30d'). Do not sort the DB for lists.
  - Use `CardanoTopMarketCap` for “top market cap” (type 'mcap'). Do not sort the DB.
  - Use `CardanoTokenLinks` for socials/links.
- Increased `maxSteps` to 10 for multi-tool plans (bot, delegate-price-agent, delegate-sql-agent).
- Enabled memory with vector store + embeddings for Mister and Price Agent.
- Discord bot now passes `memory.resource` and `memory.thread` so working memory persists per user/channel.

## Memory Setup
- Storage: `LibSQLStore`
- Vector: `LibSQLVector`
- Embedder: `openai.embedding('text-embedding-3-small')`
- Conversation: `lastMessages: 5`
- Semantic Recall: `topK: 3`, `messageRange: 3` (RAG-based recall from older messages)
- Working Memory: enabled with concise templates

### Mister (src/mastra/agents/mister.ts)
- Working Memory Template:
  - Preferred fiat, timezone, risk tolerance
  - Favorite tickers, preferred interval
  - Notes

### Price Agent (src/mastra/agents/price-agent.ts)
- Working Memory Template:
  - Quote currency, timeframe focus
  - Cardano tokens of interest
  - Exchanges preferred (Kraken/CMC/TapTools)
  - Alerts / thresholds
  - Notes

## When to Use Which Tool
- L1 prices (BTC/ETH/SOL/ADA): Kraken or CMC quotes.
- Cardano token prices/ohlcv: Resolve with `tickerToUnitTool`, then TapTools (`ohlcvDataTool`).
- Top lists: `CardanoTopVolume` and `CardanoTopMarketCap` (fresh, don’t use DB rankings).
- Links: `CardanoTokenLinks`.
- Bigger lists/compare multiple tokens: Delegate to Price Agent first, then add commentary.

## Best Practices
- Keep answers short and clear. Use active voice. No fluff.
- Always prefer live TapTools data for Cardano lists and prices.
- Memory:
  - Use thread/resource IDs so memory persists.
  - Working memory sits outside the prompt window; keep it tidy and relevant.
- Limit context:
  - `lastMessages: 5` is a sweet spot for small models.
  - `topK: 3` semantic recall to pull only the most relevant past facts.

## Cloud Notes
- Vector/RAG works in cloud with persistent DB:
  - Use LibSQL/Turso via `process.env.DATABASE_URL` (and `DATABASE_AUTH_TOKEN` if needed) for both storage and vector.
- Ensure env keys:
  - `OPENROUTER_API_KEY` (or `OPENAI_API_KEY`), `TAPTOOLS_API_KEY`, `CMC_API_KEY`, `DATABASE_URL`.

## Next Session TODOs
- Add stablecoin filtering defaults for top lists.
- Add phrase→timeframe utility function for uniform mapping across agents.
- Consider a shared memory store across agents in cloud (one LibSQL DB).
- Optional: custom working memory templates per agent for richer profiles.
