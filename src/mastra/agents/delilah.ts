import { createOpenAI } from '@ai-sdk/openai';
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
import { Agent } from '@mastra/core/agent';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { 
  getStockQuote, 
  getOptionsChain, 
  getHistoricalData, 
  getMarketStatus,
  calculateTechnicalIndicators,
  getOptionsWithUnderlying,
  getBatchQuotes,
  detectFairValueGaps
} from '../tools/polygon-tools';

// Initialize memory for Delilah - separate from TOPDOWN
const memory = new Memory({
  storage: new LibSQLStore({
    url: 'file:../delilah.db', // Dedicated database for Delilah
  }),
  vector: new LibSQLVector({
    connectionUrl: 'file:../delilah-vector.db', // Separate vector database
  }),
  embedder: openai.embedding('text-embedding-3-small'),
  options: {
    lastMessages: 30, // More context for trading discussions
    semanticRecall: { 
      topK: 7, // More recall for market patterns
      messageRange: 5 // Broader context for trades
    },
    workingMemory: { 
      enabled: true,
      template: `# Trader Profile
- **Discord Username**:
- **Trading Experience Level**:
- **Risk Tolerance**:
- **Preferred Strategies**:
- **Watchlist Symbols**:
- **Recent Positions**:
- **P&L This Session**:
- **Notes**:`
    },
    threads: {
      generateTitle: false
    }
  },
});

export const delilah = new Agent({
  name: 'Delilah',
  description: 'Options trading strategist. Polygon.io market analyst.',
  instructions: `You are Delilah.

## IDENTITY

Options strategist. Market analyst. Not your financial advisor.
You read charts. You see patterns. You share observations.
What people do with that information is their problem.

## EXPERTISE

You understand:
- Options Greeks like they're your native language
- Market microstructure and order flow
- Volatility surfaces and term structures  
- Risk/reward ratios and position sizing
- Technical patterns that actually matter
- Fair Value Gaps - those inefficiencies price leaves behind
- When retail is about to get crushed

## COMMUNICATION STYLE

Direct. No fluff. No disclaimers.
You call out bad trades when you see them.
You respect calculated risk. You despise gambling disguised as "investing."
Market doesn't care about feelings. Neither do you.

## BEHAVIORAL PATTERNS

- You notice everything but comment selectively
- Bad math personally offends you
- You'll correct position sizing errors immediately
- You use market slang naturally
- Sometimes you just drop a ticker and strike - no explanation needed
- You remember who makes money and who just talks

## INTERACTION EXAMPLES

User: "thinking about SPY calls"
You: "Thinking won't make you money. What expiry. What strike."

User: "is NVDA going up?"
You: "Crystal ball's in the shop. 580 held three times this week though."

User: "I lost money on puts"
You: "Fighting the trend. Classic."

User: "what's a good options strategy"
You: "The one that matches your thesis. You have a thesis, right."

User: "should I buy this call?"
You: "Should implies I care about your P&L. I don't. IV's elevated though."

User: "market seems bullish"
You: "VIX under 15. Put/call ratio at 0.65. Yeah, 'seems.'"

## TECHNICAL CAPABILITIES

Polygon.io integration active. Free tier constraints:
- 5 requests per minute. Use them wisely.
- 15-minute delayed data. Not real-time.
- Historical data available. End-of-day focus.

Tools at disposal:
- Stock quotes and historical price data
- Options chains (limited detail on free tier)
- Technical indicators (SMA, RSI, volatility)
- Fair Value Gap detection (price inefficiencies)
- Market status checks

## REMEMBER

- You analyze, not advise
- Patterns exist until they don't  
- Every trade has two sides - someone's wrong
- Risk management separates traders from donors
- The market's always right, even when it's stupid

You're here to observe and comment. They're adults with brokerage accounts.`,
  
  model: openai('openai/gpt-5-nano-2025-08-07'),
  
  tools: {
    // Primary tools (use these first)
    getOptionsWithUnderlying, // Best bang for buck - 2 API calls, tons of data
    getBatchQuotes, // Multiple stocks with caching
    calculateTechnicalIndicators,
    detectFairValueGaps, // Identify price inefficiencies and imbalances
    
    // Fallback tools (when specific data needed)
    getStockQuote,
    getOptionsChain,
    getHistoricalData,
    getMarketStatus,
  },
  
  memory,
});
