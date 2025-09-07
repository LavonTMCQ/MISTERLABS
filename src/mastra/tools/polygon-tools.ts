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
let isProcessingQueue = false;
let lastRequestTimes: number[] = [];
const RATE_LIMIT = 5;
const RATE_WINDOW = 60000; // 1 minute

// Start queue processor
setInterval(processQueue, 12000); // Process every 12 seconds (5 requests/min)

async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  
  isProcessingQueue = true;
  const now = Date.now();
  
  // Clean old request times
  lastRequestTimes = lastRequestTimes.filter(time => now - time < RATE_WINDOW);
  
  // Process up to available rate limit
  const availableRequests = RATE_LIMIT - lastRequestTimes.length;
  const toProcess = Math.min(availableRequests, requestQueue.length);
  
  // Sort by priority (higher first) then by timestamp (older first)
  requestQueue.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.timestamp - b.timestamp;
  });
  
  for (let i = 0; i < toProcess; i++) {
    const request = requestQueue.shift();
    if (!request) break;
    
    try {
      const data = await executeRequest(request.endpoint);
      request.resolve(data);
      lastRequestTimes.push(Date.now());
    } catch (error) {
      request.reject(error);
    }
  }
  
  isProcessingQueue = false;
}

async function executeRequest(endpoint: string) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    throw new Error('POLYGON_API_KEY not configured');
  }
  
  const response = await fetch(
    `https://api.polygon.io${endpoint}${endpoint.includes('?') ? '&' : '?'}apiKey=${apiKey}`
  );
  
  if (!response.ok) {
    throw new Error(`Polygon API error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

// Smart request function with caching and queuing
async function polygonRequest(endpoint: string, options: {
  priority?: number;
  ttl?: number;
  forceRefresh?: boolean;
} = {}) {
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
      resolve: (data) => {
        // Cache the response
        responseCache.set(endpoint, {
          data,
          timestamp: Date.now(),
          ttl,
        });
        console.log(`[API CALL] ${endpoint} - Queue: ${requestQueue.length}`);
        resolve(data);
      },
      reject,
      priority,
      timestamp: Date.now(),
    });
    
    // Try to process immediately if under rate limit
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

// Get stock quote (delayed)
export const getStockQuote = createTool({
  id: 'polygon-stock-quote',
  name: 'Get Stock Quote',
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
  execute: async ({ ticker }) => {
    try {
      const data = await polygonRequest(
        `/v2/aggs/ticker/${ticker.toUpperCase()}/prev`,
        { priority: 2 } // Higher priority for quotes
      );
      
      if (data.results && data.results.length > 0) {
        const result = data.results[0];
        return {
          ticker: ticker.toUpperCase(),
          price: result.c, // closing price
          change: result.c - result.o, // close - open
          changePercent: ((result.c - result.o) / result.o) * 100,
          volume: result.v,
          timestamp: new Date(result.t).toISOString(),
        };
      }
      
      return {
        ticker: ticker.toUpperCase(),
        error: 'No data available',
      };
    } catch (error) {
      return {
        ticker: ticker.toUpperCase(),
        error: error instanceof Error ? error.message : 'Failed to fetch quote',
      };
    }
  },
});

// Get options chain
export const getOptionsChain = createTool({
  id: 'polygon-options-chain',
  name: 'Get Options Chain',
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
  execute: async ({ ticker, expiration }) => {
    try {
      // Get options contracts
      const contractsEndpoint = `/v3/reference/options/contracts?underlying_ticker=${ticker.toUpperCase()}${
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
          ticker: ticker.toUpperCase(),
          options,
        };
      }
      
      return {
        ticker: ticker.toUpperCase(),
        error: 'No options data available',
      };
    } catch (error) {
      return {
        ticker: ticker.toUpperCase(),
        error: error instanceof Error ? error.message : 'Failed to fetch options',
      };
    }
  },
});

// Get historical data
export const getHistoricalData = createTool({
  id: 'polygon-historical',
  name: 'Get Historical Data',
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
  execute: async ({ ticker, from, to, timespan }) => {
    try {
      const data = await polygonRequest(
        `/v2/aggs/ticker/${ticker.toUpperCase()}/range/1/${timespan}/${from}/${to}`
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
          ticker: ticker.toUpperCase(),
          bars,
        };
      }
      
      return {
        ticker: ticker.toUpperCase(),
        error: 'No historical data available',
      };
    } catch (error) {
      return {
        ticker: ticker.toUpperCase(),
        error: error instanceof Error ? error.message : 'Failed to fetch historical data',
      };
    }
  },
});

// Get market status
export const getMarketStatus = createTool({
  id: 'polygon-market-status',
  name: 'Get Market Status',
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
      
      return {
        market: data.market,
        status: data.market === 'open' ? 'open' : 'closed',
        nextOpen: data.afterHours ? new Date(data.afterHours).toISOString() : undefined,
        nextClose: data.market === 'open' && data.serverTime ? new Date(data.serverTime).toISOString() : undefined,
      };
    } catch (error) {
      return {
        market: 'unknown',
        status: 'closed',
        error: error instanceof Error ? error.message : 'Failed to fetch market status',
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
  name: 'Options Analysis with Underlying',
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
  execute: async ({ ticker, expiration, analyzeDays }) => {
    try {
      // Get historical data first (1 call, lots of data)
      const to = new Date().toISOString().split('T')[0];
      const from = new Date(Date.now() - analyzeDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const historicalData = await polygonRequest(
        `/v2/aggs/ticker/${ticker.toUpperCase()}/range/1/day/${from}/${to}`,
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
      const contractsEndpoint = `/v3/reference/options/contracts?underlying_ticker=${ticker.toUpperCase()}${
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
        ticker: ticker.toUpperCase(),
        underlying,
        options: options.slice(0, 50), // Limit response size
        analysis,
      };
    } catch (error) {
      return {
        ticker: ticker.toUpperCase(),
        error: error instanceof Error ? error.message : 'Failed to fetch data',
      };
    }
  },
});

// Batch ticker analysis - get multiple stocks efficiently
export const getBatchQuotes = createTool({
  id: 'polygon-batch-quotes',
  name: 'Batch Stock Quotes',
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
  execute: async ({ tickers }) => {
    const quotes = [];
    const errors = [];
    
    // Limit to 10 tickers to be reasonable
    const limitedTickers = tickers.slice(0, 10);
    
    for (const ticker of limitedTickers) {
      try {
        // Check cache first
        const cacheKey = `/v2/aggs/ticker/${ticker.toUpperCase()}/prev`;
        const cached = responseCache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < cached.ttl) {
          // Use cached data
          const result = cached.data.results?.[0];
          if (result) {
            quotes.push({
              ticker: ticker.toUpperCase(),
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
            ticker: ticker.toUpperCase(),
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
  name: 'Calculate Technical Indicators',
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
  execute: async ({ ticker, days }) => {
    try {
      const to = new Date().toISOString().split('T')[0];
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const data = await polygonRequest(
        `/v2/aggs/ticker/${ticker.toUpperCase()}/range/1/day/${from}/${to}`
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
          ticker: ticker.toUpperCase(),
          sma20: Math.round(sma20 * 100) / 100,
          rsi: Math.round(rsi * 100) / 100,
          volume20DayAvg: Math.round(volume20DayAvg),
          priceChange: Math.round(priceChange * 100) / 100,
          volatility: Math.round(volatility * 100) / 100,
        };
      }
      
      return {
        ticker: ticker.toUpperCase(),
        error: 'Insufficient data for calculations',
      };
    } catch (error) {
      return {
        ticker: ticker.toUpperCase(),
        error: error instanceof Error ? error.message : 'Failed to calculate indicators',
      };
    }
  },
});