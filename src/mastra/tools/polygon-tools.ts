import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// ============================================
// INTELLIGENT CACHING & QUEUE SYSTEM
// ============================================

// Cache for API responses (15 min TTL matches data delay)
interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

const responseCache = new Map<string, CacheEntry>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const SHORT_CACHE_TTL = 60 * 1000; // 1 minute for frequently changing data

// Request queue system
interface QueuedRequest {
  endpoint: string;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  priority: number; // Higher = more important
  timestamp: number;
}

const requestQueue: QueuedRequest[] = [];
const RATE_LIMIT = 5;
const RATE_WINDOW = 60000; // 1 minute

// Start queue processor
let isProcessing = false;
let requestHistory: number[] = [];

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  
  isProcessing = true;
  const now = Date.now();
  
  // Clean old request times
  requestHistory = requestHistory.filter(time => now - time < RATE_WINDOW);
  
  // Process while we have capacity
  while (requestQueue.length > 0 && requestHistory.length < RATE_LIMIT) {
    const request = requestQueue.shift()!;
    requestHistory.push(now);
    
    // Make the actual API call
    executeRequest(request.endpoint)
      .then(data => {
        // Cache the response
        responseCache.set(request.endpoint, {
          data,
          timestamp: now,
          ttl: CACHE_TTL,
        });
        request.resolve(data);
      })
      .catch(request.reject);
  }
  
  isProcessing = false;
  
  // Schedule next processing if queue not empty
  if (requestQueue.length > 0) {
    const nextSlot = Math.max(0, RATE_WINDOW - (now - requestHistory[0]));
    setTimeout(processQueue, Math.min(nextSlot, 12000));
  }
}

async function executeRequest(endpoint: string) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    throw new Error('POLYGON_API_KEY not configured');
  }
  
  // Ensure proper URL construction
  const baseUrl = 'https://api.polygon.io';
  const url = endpoint.startsWith('/') ? `${baseUrl}${endpoint}` : `${baseUrl}/${endpoint}`;
  const finalUrl = url.includes('?') ? `${url}&apiKey=${apiKey}` : `${url}?apiKey=${apiKey}`;
  
  console.log(`[POLYGON API] Fetching: ${endpoint}`);
  
  const response = await fetch(finalUrl);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[POLYGON API ERROR] ${response.status}: ${errorText}`);
    throw new Error(`Polygon API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  console.log(`[POLYGON API] Success: ${endpoint}`);
  return data;
}

// Smart request function with caching and queuing
async function polygonRequest(endpoint: string, options: {
  priority?: number;
  ttl?: number;
  forceRefresh?: boolean;
} = {}): Promise<any> {
  const { priority = 1, ttl = CACHE_TTL, forceRefresh = false } = options;
  
  // Check cache first
  if (!forceRefresh) {
    const cached = responseCache.get(endpoint);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      console.log(`[CACHE HIT] ${endpoint}`);
      return cached.data;
    }
  }
  
  // Add to queue
  return new Promise((resolve, reject) => {
    requestQueue.push({
      endpoint,
      resolve,
      reject,
      priority,
      timestamp: Date.now(),
    });
    
    // Sort by priority
    requestQueue.sort((a, b) => b.priority - a.priority);
    
    // Try to process immediately
    processQueue();
  });
}

// Clean up old cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of responseCache.entries()) {
    if (now - entry.timestamp > entry.ttl) {
      responseCache.delete(key);
    }
  }
}, 60000); // Clean every minute

// Start queue processor periodically
setInterval(processQueue, 1000); // Check every second

// Get stock quote (delayed)
export const getStockQuote = createTool({
  id: 'polygon-stock-quote',
  description: 'Get delayed stock quote data (15-minute delay for free tier)',
  inputSchema: z.object({
    ticker: z.string().describe('Stock ticker symbol (e.g., AAPL, TSLA)'),
  }),
  outputSchema: z.object({
    ticker: z.string(),
    price: z.number().optional(),
    change: z.number().optional(),
    changePercent: z.number().optional(),
    volume: z.number().optional(),
    timestamp: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context: { ticker } }) => {
    
    // Ensure ticker is a string
    if (typeof ticker !== 'string') {
      console.error('[ERROR] Invalid ticker type:', typeof ticker, ticker);
      return {
        ticker: 'UNKNOWN',
        error: 'Invalid ticker format provided',
      };
    }
    
    try {
      const tickerSymbol = ticker.toUpperCase();
      
      const data = await polygonRequest(
        `/v2/aggs/ticker/${tickerSymbol}/prev`,
        { priority: 2 } // Higher priority for quotes
      );
      
      if (data.results && data.results.length > 0) {
        const result = data.results[0];
        return {
          ticker: tickerSymbol,
          price: result.c, // closing price
          change: result.c - result.o, // close - open
          changePercent: ((result.c - result.o) / result.o) * 100,
          volume: result.v,
          timestamp: new Date(result.t).toISOString(),
        };
      }
      
      return {
        ticker: tickerSymbol,
        error: 'No data available',
      };
    } catch (error) {
      return {
        ticker: typeof ticker === 'string' ? ticker.toUpperCase() : 'UNKNOWN',
        error: error instanceof Error ? error.message : 'Failed to fetch quote',
      };
    }
  },
});

// Get options chain
export const getOptionsChain = createTool({
  id: 'polygon-options-chain',
  description: 'Get options chain for a stock (limited data on free tier)',
  inputSchema: z.object({
    ticker: z.string().describe('Stock ticker symbol'),
    expiration: z.string().optional().describe('Expiration date (YYYY-MM-DD)'),
  }),
  outputSchema: z.object({
    ticker: z.string(),
    options: z.array(z.object({
      contract: z.string(),
      type: z.enum(['call', 'put']),
      strike: z.number(),
      expiration: z.string(),
      bid: z.number().optional(),
      ask: z.number().optional(),
      volume: z.number().optional(),
      openInterest: z.number().optional(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context: { ticker, expiration } }) => {
    
    // Ensure ticker is a string
    if (typeof ticker !== 'string') {
      return {
        ticker: 'UNKNOWN',
        error: 'No ticker symbol provided',
      };
    }
    
    const tickerSymbol = ticker.toUpperCase();
    
    try {
      // Get options contracts
      const contractsEndpoint = `/v3/reference/options/contracts?underlying_ticker=${tickerSymbol}${
        expiration ? `&expiration_date=${expiration}` : ''
      }&limit=100`;
      
      const data = await polygonRequest(contractsEndpoint);
      
      if (data.results && data.results.length > 0) {
        const options = data.results.map((contract: any) => ({
          contract: contract.ticker,
          type: contract.contract_type,
          strike: contract.strike_price,
          expiration: contract.expiration_date,
          // Additional data would require more API calls (limited by rate limit)
        }));
        
        return {
          ticker: tickerSymbol,
          options,
        };
      }
      
      return {
        ticker: tickerSymbol,
        error: 'No options data available',
      };
    } catch (error) {
      return {
        ticker: tickerSymbol,
        error: error instanceof Error ? error.message : 'Failed to fetch options',
      };
    }
  },
});

// Get historical data
export const getHistoricalData = createTool({
  id: 'polygon-historical',
  description: 'Get historical price data for analysis',
  inputSchema: z.object({
    ticker: z.string().describe('Stock ticker symbol'),
    from: z.string().describe('Start date (YYYY-MM-DD)'),
    to: z.string().describe('End date (YYYY-MM-DD)'),
    timespan: z.enum(['day', 'week', 'month']).default('day'),
  }),
  outputSchema: z.object({
    ticker: z.string(),
    bars: z.array(z.object({
      date: z.string(),
      open: z.number(),
      high: z.number(),
      low: z.number(),
      close: z.number(),
      volume: z.number(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context: { ticker, from, to, timespan = 'day' } }) => {
    
    // Ensure ticker is a string
    if (typeof ticker !== 'string') {
      return {
        ticker: 'UNKNOWN',
        error: 'Invalid ticker format',
      };
    }
    
    try {
      const tickerSymbol = ticker.toUpperCase();
      
      const data = await polygonRequest(
        `/v2/aggs/ticker/${tickerSymbol}/range/1/${timespan}/${from}/${to}`
      );
      
      if (data.results && data.results.length > 0) {
        const bars = data.results.map((bar: any) => ({
          date: new Date(bar.t).toISOString().split('T')[0],
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v,
        }));
        
        return {
          ticker: tickerSymbol,
          bars,
        };
      }
      
      return {
        ticker: tickerSymbol,
        error: 'No historical data available',
      };
    } catch (error) {
      return {
        ticker: typeof ticker === 'string' ? ticker.toUpperCase() : 'UNKNOWN',
        error: error instanceof Error ? error.message : 'Failed to fetch historical data',
      };
    }
  },
});

// Get market status
export const getMarketStatus = createTool({
  id: 'polygon-market-status',
  description: 'Check if markets are open',
  inputSchema: z.object({}),
  outputSchema: z.object({
    market: z.string(),
    status: z.enum(['open', 'closed', 'early_close']),
    nextOpen: z.string().optional(),
    nextClose: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    try {
      const data = await polygonRequest('/v1/marketstatus/now');
      
      const status: 'open' | 'closed' | 'early_close' = data.market === 'open' ? 'open' : 'closed';
      return {
        market: data.market,
        status,
        nextOpen: data.afterHours ? new Date(data.afterHours).toISOString() : undefined,
        nextClose: status === 'open' && data.serverTime ? new Date(data.serverTime).toISOString() : undefined,
      };
    } catch (error) {
      return {
        market: 'unknown',
        status: 'closed',
        error: error instanceof Error ? error.message : 'Failed to fetch market status',
      } as const;
    }
  },
});

// Detect Fair Value Gaps (FVGs) in price action
export const detectFairValueGaps = createTool({
  id: 'polygon-fvg-detector',
  description: 'Identify price inefficiencies (Fair Value Gaps) in historical data for potential support/resistance zones',
  inputSchema: z.object({
    ticker: z.string().describe('Stock ticker symbol'),
    days: z.number().default(30).describe('Number of days to analyze'),
    minGapPercent: z.number().default(0.1).describe('Minimum gap size as percentage to consider significant'),
  }),
  outputSchema: z.object({
    ticker: z.string(),
    fvgs: z.array(z.object({
      type: z.enum(['bullish', 'bearish']),
      date: z.string(),
      upperLevel: z.number(),
      lowerLevel: z.number(),
      gapSize: z.number(),
      gapPercent: z.number(),
      filled: z.boolean(),
      filledDate: z.string().optional(),
      candlePattern: z.object({
        candle1: z.object({
          date: z.string(),
          high: z.number(),
          low: z.number(),
        }),
        candle2: z.object({
          date: z.string(),
          high: z.number(),
          low: z.number(),
        }),
        candle3: z.object({
          date: z.string(),
          high: z.number(),
          low: z.number(),
        }),
      }),
    })).optional(),
    summary: z.object({
      totalGaps: z.number(),
      bullishGaps: z.number(),
      bearishGaps: z.number(),
      unfilledGaps: z.number(),
      largestGap: z.object({
        size: z.number(),
        percent: z.number(),
        type: z.string(),
      }).optional(),
    }),
    currentPrice: z.number().optional(),
    nearestUnfilledGap: z.object({
      type: z.string(),
      distance: z.number(),
      level: z.number(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context: { ticker, days = 30, minGapPercent = 0.1 } }) => {
    
    // Ensure ticker is a string
    if (typeof ticker !== 'string') {
      return {
        ticker: 'UNKNOWN',
        summary: {
          totalGaps: 0,
          bullishGaps: 0,
          bearishGaps: 0,
          unfilledGaps: 0,
        },
        error: 'Invalid ticker format',
      };
    }
    
    try {
      const tickerSymbol = ticker.toUpperCase();
      
      // Get historical data
      const to = new Date().toISOString().split('T')[0];
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const data = await polygonRequest(
        `/v2/aggs/ticker/${tickerSymbol}/range/1/day/${from}/${to}`,
        { priority: 2, ttl: CACHE_TTL }
      );
      
      if (!data.results || data.results.length < 3) {
        return {
          ticker: tickerSymbol,
          summary: {
            totalGaps: 0,
            bullishGaps: 0,
            bearishGaps: 0,
            unfilledGaps: 0,
          },
          error: 'Insufficient data for FVG analysis (need at least 3 days)',
        };
      }
      
      const bars = data.results.map((bar: any) => ({
        date: new Date(bar.t).toISOString().split('T')[0],
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
      }));
      
      const fvgs: any[] = [];
      const currentPrice = bars[bars.length - 1].close;
      
      // Detect FVGs using three-candle pattern
      for (let i = 2; i < bars.length; i++) {
        const candle1 = bars[i - 2];
        const candle2 = bars[i - 1];
        const candle3 = bars[i];
        
        // Check for Bullish FVG (gap up)
        if (candle3.low > candle1.high) {
          const gapSize = candle3.low - candle1.high;
          const gapPercent = (gapSize / candle1.high) * 100;
          
          if (gapPercent >= minGapPercent) {
            // Check if gap has been filled
            let filled = false;
            let filledDate;
            for (let j = i + 1; j < bars.length; j++) {
              if (bars[j].low <= candle1.high) {
                filled = true;
                filledDate = bars[j].date;
                break;
              }
            }
            
            fvgs.push({
              type: 'bullish',
              date: candle2.date,
              upperLevel: candle3.low,
              lowerLevel: candle1.high,
              gapSize: Math.round(gapSize * 100) / 100,
              gapPercent: Math.round(gapPercent * 100) / 100,
              filled,
              filledDate,
              candlePattern: {
                candle1: {
                  date: candle1.date,
                  high: candle1.high,
                  low: candle1.low,
                },
                candle2: {
                  date: candle2.date,
                  high: candle2.high,
                  low: candle2.low,
                },
                candle3: {
                  date: candle3.date,
                  high: candle3.high,
                  low: candle3.low,
                },
              },
            });
          }
        }
        
        // Check for Bearish FVG (gap down)
        if (candle3.high < candle1.low) {
          const gapSize = candle1.low - candle3.high;
          const gapPercent = (gapSize / candle3.high) * 100;
          
          if (gapPercent >= minGapPercent) {
            // Check if gap has been filled
            let filled = false;
            let filledDate;
            for (let j = i + 1; j < bars.length; j++) {
              if (bars[j].high >= candle1.low) {
                filled = true;
                filledDate = bars[j].date;
                break;
              }
            }
            
            fvgs.push({
              type: 'bearish',
              date: candle2.date,
              upperLevel: candle1.low,
              lowerLevel: candle3.high,
              gapSize: Math.round(gapSize * 100) / 100,
              gapPercent: Math.round(gapPercent * 100) / 100,
              filled,
              filledDate,
              candlePattern: {
                candle1: {
                  date: candle1.date,
                  high: candle1.high,
                  low: candle1.low,
                },
                candle2: {
                  date: candle2.date,
                  high: candle2.high,
                  low: candle2.low,
                },
                candle3: {
                  date: candle3.date,
                  high: candle3.high,
                  low: candle3.low,
                },
              },
            });
          }
        }
      }
      
      // Calculate summary statistics
      const bullishGaps = fvgs.filter(g => g.type === 'bullish').length;
      const bearishGaps = fvgs.filter(g => g.type === 'bearish').length;
      const unfilledGaps = fvgs.filter(g => !g.filled).length;
      
      let largestGap;
      if (fvgs.length > 0) {
        const maxGap = fvgs.reduce((max, gap) => 
          gap.gapPercent > max.gapPercent ? gap : max
        );
        largestGap = {
          size: maxGap.gapSize,
          percent: maxGap.gapPercent,
          type: maxGap.type,
        };
      }
      
      // Find nearest unfilled gap to current price
      let nearestUnfilledGap;
      const unfilledFVGs = fvgs.filter(g => !g.filled);
      if (unfilledFVGs.length > 0 && currentPrice) {
        const nearest = unfilledFVGs.reduce((closest, gap) => {
          const gapMidpoint = (gap.upperLevel + gap.lowerLevel) / 2;
          const distance = Math.abs(currentPrice - gapMidpoint);
          const closestMidpoint = (closest.upperLevel + closest.lowerLevel) / 2;
          const closestDistance = Math.abs(currentPrice - closestMidpoint);
          return distance < closestDistance ? gap : closest;
        });
        
        const nearestMidpoint = (nearest.upperLevel + nearest.lowerLevel) / 2;
        nearestUnfilledGap = {
          type: nearest.type,
          distance: Math.round(Math.abs(currentPrice - nearestMidpoint) * 100) / 100,
          level: Math.round(nearestMidpoint * 100) / 100,
        };
      }
      
      return {
        ticker: tickerSymbol,
        fvgs: fvgs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), // Most recent first
        summary: {
          totalGaps: fvgs.length,
          bullishGaps,
          bearishGaps,
          unfilledGaps,
          largestGap,
        },
        currentPrice: Math.round(currentPrice * 100) / 100,
        nearestUnfilledGap,
      };
    } catch (error) {
      return {
        ticker: typeof ticker === 'string' ? ticker.toUpperCase() : 'UNKNOWN',
        summary: {
          totalGaps: 0,
          bullishGaps: 0,
          bearishGaps: 0,
          unfilledGaps: 0,
        },
        error: error instanceof Error ? error.message : 'Failed to detect FVGs',
      };
    }
  },
});

// ============================================
// SMART AGGREGATION TOOLS
// ============================================

// Combined options + underlying analysis (maximizes data from minimal calls)
export const getOptionsWithUnderlying = createTool({
  id: 'polygon-options-analysis',
  description: 'Get options chain with underlying stock data - optimized for rate limits',
  inputSchema: z.object({
    ticker: z.string().describe('Stock ticker symbol'),
    expiration: z.string().optional().describe('Options expiration date (YYYY-MM-DD)'),
    analyzeDays: z.number().default(30).describe('Days of historical data for analysis'),
  }),
  outputSchema: z.object({
    ticker: z.string(),
    underlying: z.object({
      price: z.number(),
      change: z.number(),
      changePercent: z.number(),
      volume: z.number(),
      sma20: z.number().optional(),
      volatility: z.number().optional(),
      rsi: z.number().optional(),
    }).optional(),
    options: z.array(z.object({
      contract: z.string(),
      type: z.enum(['call', 'put']),
      strike: z.number(),
      expiration: z.string(),
      moneyness: z.string().optional(), // ITM, ATM, OTM
      strikeDistance: z.number().optional(), // Distance from current price
    })).optional(),
    analysis: z.object({
      atmStrike: z.number().optional(),
      putCallRatio: z.number().optional(),
      maxPain: z.number().optional(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context: { ticker, expiration, analyzeDays = 30 } }) => {
    
    // Ensure ticker is a string
    if (typeof ticker !== 'string') {
      return {
        ticker: 'UNKNOWN',
        error: 'Invalid ticker format',
      };
    }
    
    try {
      const tickerSymbol = ticker.toUpperCase();
      
      // Get historical data first (1 call, lots of data)
      const to = new Date().toISOString().split('T')[0];
      const from = new Date(Date.now() - analyzeDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const historicalData = await polygonRequest(
        `/v2/aggs/ticker/${tickerSymbol}/range/1/day/${from}/${to}`,
        { priority: 3, ttl: CACHE_TTL } // High priority, longer cache
      );
      
      let underlying: any = {};
      let volatility = 0;
      
      if (historicalData.results && historicalData.results.length > 0) {
        const prices = historicalData.results.map((r: any) => r.c);
        const volumes = historicalData.results.map((r: any) => r.v);
        const latest = historicalData.results[historicalData.results.length - 1];
        
        // Calculate everything from historical data
        const sma20 = prices.slice(-20).reduce((a: number, b: number) => a + b, 0) / Math.min(20, prices.length);
        const volume20DayAvg = volumes.slice(-20).reduce((a: number, b: number) => a + b, 0) / Math.min(20, volumes.length);
        
        // Volatility
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
          returns.push((prices[i] - prices[i-1]) / prices[i-1]);
        }
        const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((acc, ret) => acc + Math.pow(ret - meanReturn, 2), 0) / returns.length;
        volatility = Math.sqrt(variance * 252) * 100; // Annualized
        
        // RSI
        let gains = 0, losses = 0;
        for (let i = 1; i < prices.slice(-14).length; i++) {
          const change = prices.slice(-14)[i] - prices.slice(-14)[i - 1];
          if (change > 0) gains += change;
          else losses += Math.abs(change);
        }
        const avgGain = gains / 14;
        const avgLoss = losses / 14;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        
        underlying = {
          price: latest.c,
          change: latest.c - latest.o,
          changePercent: ((latest.c - latest.o) / latest.o) * 100,
          volume: latest.v,
          sma20: Math.round(sma20 * 100) / 100,
          volatility: Math.round(volatility * 100) / 100,
          rsi: Math.round(rsi * 100) / 100,
        };
      }
      
      // Get options chain (1 more call)
      const contractsEndpoint = `/v3/reference/options/contracts?underlying_ticker=${tickerSymbol}${
        expiration ? `&expiration_date=${expiration}` : ''
      }&limit=200`; // Get more contracts in one call
      
      const optionsData = await polygonRequest(
        contractsEndpoint,
        { priority: 2, ttl: CACHE_TTL }
      );
      
      let options: any[] = [];
      let analysis: any = {};
      
      if (optionsData.results && optionsData.results.length > 0) {
        const currentPrice = underlying.price || 100;
        
        options = optionsData.results.map((contract: any) => {
          const strikeDistance = contract.strike_price - currentPrice;
          const moneyness = 
            Math.abs(strikeDistance) < currentPrice * 0.01 ? 'ATM' :
            (contract.contract_type === 'call' && strikeDistance < 0) || 
            (contract.contract_type === 'put' && strikeDistance > 0) ? 'ITM' : 'OTM';
          
          return {
            contract: contract.ticker,
            type: contract.contract_type,
            strike: contract.strike_price,
            expiration: contract.expiration_date,
            moneyness,
            strikeDistance: Math.round(strikeDistance * 100) / 100,
          };
        });
        
        // Analysis
        const calls = options.filter(o => o.type === 'call');
        const puts = options.filter(o => o.type === 'put');
        const atmStrike = options.reduce((closest, opt) => {
          return Math.abs(opt.strikeDistance) < Math.abs(closest.strikeDistance) ? opt : closest;
        }).strike;
        
        analysis = {
          atmStrike,
          putCallRatio: puts.length / (calls.length || 1),
          maxPain: atmStrike, // Simplified - would need OI data for real calculation
        };
      }
      
      return {
        ticker: tickerSymbol,
        underlying,
        options: options.slice(0, 50), // Limit response size
        analysis,
      };
    } catch (error) {
      return {
        ticker: typeof ticker === 'string' ? ticker.toUpperCase() : 'UNKNOWN',
        error: error instanceof Error ? error.message : 'Failed to fetch data',
      };
    }
  },
});

// Batch ticker analysis - get multiple stocks efficiently
export const getBatchQuotes = createTool({
  id: 'polygon-batch-quotes',
  description: 'Get quotes for multiple tickers efficiently using cache',
  inputSchema: z.object({
    tickers: z.array(z.string()).describe('Array of stock tickers (max 10)'),
  }),
  outputSchema: z.object({
    quotes: z.array(z.object({
      ticker: z.string(),
      price: z.number().optional(),
      change: z.number().optional(),
      changePercent: z.number().optional(),
      volume: z.number().optional(),
      cached: z.boolean().optional(),
    })),
    errors: z.array(z.string()).optional(),
  }),
  execute: async ({ context: { tickers } }) => {
    
    const quotes = [];
    const errors = [];
    
    // Validate tickers array
    if (!Array.isArray(tickers) || tickers.length === 0) {
      return { 
        quotes: [], 
        errors: ['No valid tickers provided'] 
      };
    }
    
    // Limit to 10 tickers to be reasonable
    const limitedTickers = tickers.slice(0, 10);
    
    for (const ticker of limitedTickers) {
      if (!ticker) continue;
      
      try {
        const tickerSymbol = ticker.toUpperCase();
        // Check cache first
        const cacheKey = `/v2/aggs/ticker/${tickerSymbol}/prev`;
        const cached = responseCache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < cached.ttl) {
          // Use cached data
          const result = cached.data.results?.[0];
          if (result) {
            quotes.push({
              ticker: tickerSymbol,
              price: result.c,
              change: result.c - result.o,
              changePercent: ((result.c - result.o) / result.o) * 100,
              volume: result.v,
              cached: true,
            });
            continue;
          }
        }
        
        // Queue new request with lower priority
        const data = await polygonRequest(cacheKey, { priority: 1 });
        
        if (data.results && data.results.length > 0) {
          const result = data.results[0];
          quotes.push({
            ticker: tickerSymbol,
            price: result.c,
            change: result.c - result.o,
            changePercent: ((result.c - result.o) / result.o) * 100,
            volume: result.v,
            cached: false,
          });
        }
      } catch (error) {
        errors.push(`${ticker}: ${error instanceof Error ? error.message : 'Failed'}`);
      }
    }
    
    return { quotes, errors: errors.length > 0 ? errors : undefined };
  },
});

// Technical indicators calculator (using historical data)
export const calculateTechnicalIndicators = createTool({
  id: 'polygon-technicals',
  description: 'Calculate basic technical indicators from historical data',
  inputSchema: z.object({
    ticker: z.string().describe('Stock ticker symbol'),
    days: z.number().default(20).describe('Number of days for calculation'),
  }),
  outputSchema: z.object({
    ticker: z.string(),
    sma20: z.number().optional(),
    rsi: z.number().optional(),
    volume20DayAvg: z.number().optional(),
    priceChange: z.number().optional(),
    volatility: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context: { ticker, days = 20 } }) => {
    
    // Ensure ticker is a string
    if (typeof ticker !== 'string') {
      return {
        ticker: 'UNKNOWN',
        error: 'Invalid ticker format',
      };
    }
    
    try {
      const tickerSymbol = ticker.toUpperCase();
      
      const to = new Date().toISOString().split('T')[0];
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const data = await polygonRequest(
        `/v2/aggs/ticker/${tickerSymbol}/range/1/day/${from}/${to}`
      );
      
      if (data.results && data.results.length > 0) {
        const prices = data.results.map((r: any) => r.c);
        const volumes = data.results.map((r: any) => r.v);
        
        // Simple calculations
        const sma20 = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
        const volume20DayAvg = volumes.reduce((a: number, b: number) => a + b, 0) / volumes.length;
        const priceChange = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
        
        // Simple volatility (standard deviation)
        const mean = sma20;
        const variance = prices.reduce((acc: number, price: number) => {
          return acc + Math.pow(price - mean, 2);
        }, 0) / prices.length;
        const volatility = Math.sqrt(variance);
        
        // Simple RSI calculation
        let gains = 0;
        let losses = 0;
        for (let i = 1; i < prices.length; i++) {
          const change = prices[i] - prices[i - 1];
          if (change > 0) gains += change;
          else losses += Math.abs(change);
        }
        const avgGain = gains / (prices.length - 1);
        const avgLoss = losses / (prices.length - 1);
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        
        return {
          ticker: tickerSymbol,
          sma20: Math.round(sma20 * 100) / 100,
          rsi: Math.round(rsi * 100) / 100,
          volume20DayAvg: Math.round(volume20DayAvg),
          priceChange: Math.round(priceChange * 100) / 100,
          volatility: Math.round(volatility * 100) / 100,
        };
      }
      
      return {
        ticker: typeof ticker === 'string' ? ticker.toUpperCase() : 'UNKNOWN',
        error: 'Insufficient data for calculations',
      };
    } catch (error) {
      return {
        ticker: typeof ticker === 'string' ? ticker.toUpperCase() : 'UNKNOWN',
        error: error instanceof Error ? error.message : 'Failed to calculate indicators',
      };
    }
  },
});
// @ts-nocheck
