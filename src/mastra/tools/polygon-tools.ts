import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Rate limiter to respect 5 requests per minute
let lastRequestTimes: number[] = [];
const RATE_LIMIT = 5;
const RATE_WINDOW = 60000; // 1 minute in milliseconds

async function checkRateLimit() {
  const now = Date.now();
  // Remove requests older than 1 minute
  lastRequestTimes = lastRequestTimes.filter(time => now - time < RATE_WINDOW);
  
  if (lastRequestTimes.length >= RATE_LIMIT) {
    const oldestRequest = lastRequestTimes[0];
    const waitTime = RATE_WINDOW - (now - oldestRequest);
    throw new Error(`Rate limit reached. Wait ${Math.ceil(waitTime / 1000)} seconds.`);
  }
  
  lastRequestTimes.push(now);
}

async function polygonRequest(endpoint: string) {
  await checkRateLimit();
  
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
      const data = await polygonRequest(`/v2/aggs/ticker/${ticker.toUpperCase()}/prev`);
      
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