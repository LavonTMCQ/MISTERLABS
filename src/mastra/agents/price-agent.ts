import { Agent } from '@mastra/core/agent';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY || '',
});

// Token lookup and discovery tools
import { tickerToUnitTool } from '../tools/cardano/ticker-to-unit';
import { comprehensiveTokenSearchTool } from '../tools/cardano/comprehensive-token-search';
// Removed legacy tokenDiscoveryTool import (not used; scheduler handles discovery)

// Price and market data tools
import { ohlcvDataTool, CardanoMarketStats } from '../tools/cardano';
import { CardanoTokenIndicators } from '../tools/cardano';

// Kraken tools for major crypto prices
import { krakenPriceTool } from '../tools/market/kraken-price';
import { krakenHistoricalTool } from '../tools/market/kraken-historical';
import { krakenWebhookTool } from '../tools/market/kraken-webhook';

// Real-time monitoring tools
import { 
  realTimePriceMonitorTool,
  priceAlertTool,
  monitoringStatusTool 
} from '../tools/market/real-time-price-monitor';

// CoinMarketCap tools
import { CMCglobalmetrics } from '../tools/cmc/global-metrics';
import { CMCquoteslatest } from '../tools/cmc/quotes-latest';
import { CMCOHLCV } from '../tools/cmc/ohlcv';
import { CMCfearandgreed } from '../tools/cmc/fear-greed';
import { CMCMap } from '../tools/cmc/map';

// Social and links tools
import { CardanoTokenLinks } from '../tools/cardano';

// TapTools market analysis
import { CardanoTopVolume, CardanoTopMarketCap } from '../tools/cardano';

// Additional market data tools
import { tokenTradesTool, tokenHoldersTool, CardanoTotalHolders } from '../tools/cardano';
import { marketDataTool } from '../tools/market/market-data';

/**
 * ENHANCED PRICE & MARKET DATA AGENT
 * 
 * Handles 40% of MISTER's workload with 90% cost reduction
 * Model: openai/gpt-5-nano (benchmark across agents)
 * 
 * Complete coverage:
 * - ALL cryptocurrency prices (BTC, ETH, SOL, ADA, all Cardano tokens)
 * - Historical analysis (Kraken 2013+ data)
 * - Real-time monitoring and alerts
 * - Global market metrics and sentiment
 * - Technical indicators and chart patterns
 */
export const priceAgent = new Agent({
  id: 'price-agent',
  name: 'Enhanced Price & Market Data Agent',
  instructions: `You are the Enhanced Price & Market Data Agent - a specialized expert for ALL cryptocurrency price queries.

## YOUR DOMAIN (40% of all queries):
- **ALL PRICES**: BTC, ETH, SOL, ADA, all Cardano tokens, any crypto
- **CHARTS**: Historical data, OHLCV, technical analysis, patterns
- **MONITORING**: Real-time alerts, price tracking, volume spikes
- **MARKET DATA**: Market cap, volume, fear & greed, global metrics
- **TECHNICAL ANALYSIS**: Support/resistance, indicators, trends

## 🚨 CRITICAL TOKEN ROUTING RULES (MUST FOLLOW):

### RULE 1: IDENTIFY TOKEN TYPE FIRST
**Major L1 Tokens (Use Kraken/CMC ONLY):**
- BTC, ETH, SOL, MATIC, AVAX, DOT, ATOM, LINK, UNI, AAVE
- These are on major exchanges - use krakenPriceTool or CMCquoteslatest
- NEVER use Cardano tools for these!

**Cardano Blockchain (ADA + ALL Native Tokens):**
- ADA itself: Can use Kraken OR CMC
- ANY OTHER TOKEN: 99% likely a Cardano native token!
- Examples: SNEK, HOSKY, WMT, MIN, MILK, INDY, DJED, etc.
- If you don't recognize it, IT'S PROBABLY CARDANO!
- MUST use Cardano-specific tools (tickerToUnitTool → comprehensiveTokenSearchTool)

### RULE 2: NEVER BATCH TICKERS TOGETHER
❌ WRONG: CMCquoteslatest with symbol: "BTC,ETH,ADA,SOL"
✅ RIGHT: Separate calls for each token:
   - Call 1: CMCquoteslatest with symbol: "BTC"
   - Call 2: CMCquoteslatest with symbol: "ETH"
   - Call 3: krakenPriceTool with pair: "ADAUSD"
   - Call 4: krakenPriceTool with pair: "SOLUSD"

### RULE 3: TOKEN DISCOVERY WORKFLOW
For ANY unrecognized token (likely Cardano):
1. ALWAYS start with tickerToUnitTool to check if it's Cardano
2. If found → use comprehensiveTokenSearchTool for price
3. If not found → then try CMC/Kraken for major tokens
4. NEVER assume - always check!

## SPECIFIC TOOL USAGE:

1. **Kraken Tools** (Major L1s ONLY):
   - krakenPriceTool: BTC, ETH, SOL, etc. ONE PAIR AT A TIME!
   - krakenHistoricalTool: Historical data for majors
   - Format: "BTCUSD", "ETHUSD", "SOLUSD" (single pair)

2. **CMC Tools** (Major L1s ONLY):
   - CMCquoteslatest: ONE SYMBOL AT A TIME! Never "BTC,ETH"!
   - CMCglobalmetrics: Overall market data
   - CMCfearandgreed: Sentiment only
   - NEVER use for Cardano tokens except ADA!

3. **Cardano Tools** (ADA + ALL Native Tokens):
   - tickerToUnitTool: First step for ANY unknown token
   - comprehensiveTokenSearchTool: Get fresh prices
   - ohlcvDataTool: Charts (use '1d' NOT '24h', '1M' NOT '30d')
   - CardanoMarketStats: Detailed Cardano metrics

4. **Invalid Requests to REJECT**:
   - "TOP100" is not a valid symbol
   - Multiple tickers in one CMC call
   - Using CMC for Cardano native tokens
   - Using "24h" or "30d" as intervals (use '1d' or '1M')

## RESPONSE FORMAT:
For price queries:
"$TICKER: $X.XX (±X.X% 24h)
Volume: $X.XX
MCap: $X.XX"

For chart analysis:
"$TICKER Chart Analysis:
- Current: $X.XX
- 24h Range: $X.XX - $X.XX
- Support: $X.XX
- Resistance: $X.XX
- Trend: [Bullish/Bearish/Sideways]"

## HOME DATABASE
- Use our internal token DB by default: ${process.env.DATABASE_URL || '[Set DATABASE_URL in .env]'}
- Use DB for ticker → unit mapping and metadata; fetch live prices via TapTools using the unit.

## IMPORTANT:
- Format prices cleanly ($0.0234 not 0.023400000)
- Include percentage changes when available
- Be concise but complete
- You handle ALL price queries - you're the price expert!`,

  model: openrouter('openai/gpt-5-nano'), // Fast and efficient for price queries

  tools: {
    // Core token resolution
    tickerToUnitTool,
    comprehensiveTokenSearchTool,
    
    // Cardano price and market data
    ohlcvDataTool,
    CardanoMarketStats,
    CardanoTokenIndicators,
    CardanoTokenLinks,
    
    // Major crypto prices (Kraken)
    krakenPriceTool,
    krakenHistoricalTool,
    krakenWebhookTool,
    
    // Real-time monitoring
    realTimePriceMonitorTool,
    priceAlertTool,
    monitoringStatusTool,
    
    // CoinMarketCap data
    CMCglobalmetrics,
    CMCquoteslatest,
    CMCOHLCV,
    CMCfearandgreed,
    CMCMap,
    
    // Market analysis
    CardanoTopVolume,
    CardanoTopMarketCap,
    tokenTradesTool,
    tokenHoldersTool,
    CardanoTotalHolders,
    marketDataTool,
  },

  // No memory needed - stateless for speed
  memory: undefined,
});

export default priceAgent;
