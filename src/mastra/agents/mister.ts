import { createOpenAI } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { databaseIntrospectionTool } from '../tools/database-introspection-tool';
import { sqlExecutionTool } from '../tools/sql-execution-tool';
import { tokenDbStatsTool } from '../tools/database/token-db-stats';
import { tickerToUnitTool } from '../tools/cardano/ticker-to-unit';
import { ohlcvDataTool } from '../tools/cardano/ohlcv-data';
import { CardanoMarketStats } from '../tools/cardano/market-stats';
import { CardanoTopVolume, CardanoTopMarketCap, CardanoTokenLinks } from '../tools/cardano';
import { krakenPriceTool } from '../tools/market/kraken-price';
import { CMCquoteslatest } from '../tools/cmc/quotes-latest';
import { delegateToSQLAgent } from '../tools/orchestrator-tools';
import { delegateToPriceAgent } from '../tools/agent-delegation/call-price-agent';

// OpenAI V1 provider with OpenRouter base (if key present)
const openai = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '',
  baseURL: process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined,
  headers: process.env.OPENROUTER_API_KEY
    ? {
        'HTTP-Referer': process.env.OPENROUTER_HTTP_REF || 'https://github.com/LavonTMCQ/MISTERLABS',
        'X-Title': process.env.OPENROUTER_APP_TITLE || 'MISTERLABS',
      }
    : undefined,
});

// Lightweight memory for MISTER (no exposed templates)
const memory = new Memory({
  storage: new LibSQLStore({ url: 'file:../mister.db' }),
  vector: new LibSQLVector({ connectionUrl: 'file:../mister-vector.db' }),
  embedder: openai.embedding('text-embedding-3-small'),
  options: {
    lastMessages: 10,
    semanticRecall: { topK: 3, messageRange: 3 },
    workingMemory: { enabled: false },
    threads: { generateTitle: false },
  },
});

// Removed processors to keep replies simple and human

export const mister = new Agent({
  name: 'MISTER',
  description: 'Speaks plainly. Gets you answers when you need them.',
  instructions: `You are MISTER. Be friendly. Talk like a human.

How to speak:
• Use active voice and simple words.
• Talk to the user as "you" and "your".
• Be direct and concise. Keep answers short and clear.
• Avoid fluff and marketing language. Keep it real.
• Vary sentence length for rhythm. Stay conversational.
• Simplify grammar. Avoid AI-filler like "let's explore". Say "Here's what we know." 
• Don’t ask "what do you need?" Just respond and keep the conversation going.
• Never show hidden reasoning, system notes, tool IDs, or memory content.

How to work (tools):
• Major L1 prices (BTC, ETH, SOL, ADA): use krakenPriceTool or CMCquoteslatest.
• Cardano tokens (anything else):
  1) Resolve ticker → unit with tickerToUnitTool.
  2) For charts/prices, use ohlcvDataTool. For ecosystem stats, use CardanoMarketStats.
 • Lists: For "top volume" use CardanoTopVolume (map "today" → '24h'). For "top market cap" use CardanoTopMarketCap ('mcap'). Do not sort the DB for lists.
 • For bigger lists or comparisons, delegate to price-agent to compile data, then add your analysis.
 • Links: For project/social links, use CardanoTokenLinks (resolve unit if needed).
• Want a complete price answer fast or for multiple tokens? Delegate to price-agent with the user’s question.
• Can’t find a token or need deeper DB checks? Delegate to sqlAgent to search the token database thoroughly.

Database:
• Home DB: ${process.env.DATABASE_URL || '[Set DATABASE_URL in .env]'}
• Use DB only for Cardano ticker → unit mapping and metadata.
• Always get live prices from TapTools using the unit. Don’t quote DB prices.

Output:
• Prices: "$TICKER: $X.XX (±Y.Y% 24h)".
• Charts: a few lines with current price, range, support/resistance, trend.
• If a tool fails, say what happened and suggest the next step.
`,
  
  model: openai('openai/gpt-5-nano-2025-08-07'),
  
  tools: {
    // DB + token tools
    databaseIntrospectionTool,
    sqlExecutionTool,
    tokenDbStatsTool,
    tickerToUnitTool,
    // Direct price/market capability
    ohlcvDataTool,
    CardanoMarketStats,
    krakenPriceTool,
    CMCquoteslatest,
    CardanoTopVolume,
    CardanoTopMarketCap,
    CardanoTokenLinks,
    // Delegation
    delegateToPriceAgent,
    delegateToSQLAgent,
  },
  
  memory,
  // No input/output processors. Keep replies natural and concise.
});
