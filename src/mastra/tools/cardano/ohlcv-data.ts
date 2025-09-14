import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { tapToolsAPI } from '../../services/taptools-api';
import { RuntimeContext } from '@mastra/core/runtime-context';

// Valid timeframe intervals for TapTools API
const VALID_INTERVALS = ['3m', '5m', '15m', '30m', '1h', '2h', '4h', '12h', '1d', '3d', '1w', '1M'] as const;

/**
 * Format OHLCV data for chart generation
 */
function formatOHLCVData(data: any[], tokenData: any) {
  return data.map((candle, index) => {
    // Handle timestamp validation and conversion
    // TapTools returns 'time' field (not 'timestamp')
    let timestamp = candle.time || candle.timestamp;
    let date: string;
    let dateFormatted: string;
    let timeFormatted: string;
    
    try {
      // Check if timestamp is valid
      if (typeof timestamp === 'number' && timestamp > 0) {
        // If timestamp is in seconds, convert to milliseconds
        const timestampMs = timestamp > 1e10 ? timestamp : timestamp * 1000;
        const dateObj = new Date(timestampMs);
        
        // Validate the date
        if (isNaN(dateObj.getTime())) {
          throw new Error('Invalid timestamp');
        }
        
        date = dateObj.toISOString();
        dateFormatted = dateObj.toLocaleDateString();
        timeFormatted = dateObj.toLocaleTimeString();
      } else {
        // Use current time as fallback
        const now = new Date();
        date = now.toISOString();
        dateFormatted = now.toLocaleDateString();
        timeFormatted = now.toLocaleTimeString();
        timestamp = Math.floor(now.getTime() / 1000);
      }
    } catch (error) {
      // Fallback to current time if timestamp parsing fails
      const now = new Date();
      date = now.toISOString();
      dateFormatted = now.toLocaleDateString();
      timeFormatted = now.toLocaleTimeString();
      timestamp = Math.floor(now.getTime() / 1000);
    }
    
    return {
      timestamp,
      date,
      dateFormatted,
      timeFormatted,
      open: Number(candle.open) || 0,
      high: Number(candle.high) || 0,
      low: Number(candle.low) || 0,
      close: Number(candle.close) || 0,
      volume: Number(candle.volume) || 0,
      volumeFormatted: (Number(candle.volume) || 0).toLocaleString(),
      priceChange: index > 0 ? (Number(candle.close) || 0) - (Number(data[index - 1].close) || 0) : 0,
      priceChangePercent: index > 0 && (Number(data[index - 1].close) || 0) > 0 ? 
        (((Number(candle.close) || 0) - (Number(data[index - 1].close) || 0)) / (Number(data[index - 1].close) || 0)) * 100 : 0
    };
  });
}

/**
 * Calculate technical indicators and summary statistics
 */
function calculateTechnicalIndicators(data: any[]) {
  if (data.length === 0) return null;

  const prices = data.map(d => d.close).filter(p => p > 0);
  const volumes = data.map(d => d.volume).filter(v => v > 0);
  
  if (prices.length === 0) return null;

  const currentPrice = prices[prices.length - 1];
  const firstPrice = prices[0];
  const highestPrice = Math.max(...prices);
  const lowestPrice = Math.min(...prices);
  const totalVolume = volumes.reduce((sum, vol) => sum + vol, 0);
  const avgVolume = volumes.length > 0 ? totalVolume / volumes.length : 0;

  // Simple moving averages
  const sma7 = prices.length >= 7 ? 
    prices.slice(-7).reduce((sum, p) => sum + p, 0) / 7 : null;
  const sma30 = prices.length >= 30 ? 
    prices.slice(-30).reduce((sum, p) => sum + p, 0) / 30 : null;

  // Price change calculations
  const priceChange = currentPrice - firstPrice;
  const priceChangePercent = firstPrice > 0 ? (priceChange / firstPrice) * 100 : 0;

  // Volatility (standard deviation of returns)
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }
  
  const avgReturn = returns.length > 0 ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
  const variance = returns.length > 0 ? 
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length : 0;
  const volatility = Math.sqrt(variance) * 100; // Convert to percentage

  // RSI Calculation (14 periods)
  let rsi = null;
  if (prices.length >= 14) {
    const gains = [];
    const losses = [];
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        gains.push(change);
        losses.push(0);
      } else {
        gains.push(0);
        losses.push(Math.abs(change));
      }
    }
    const avgGain = gains.slice(-14).reduce((sum, g) => sum + g, 0) / 14;
    const avgLoss = losses.slice(-14).reduce((sum, l) => sum + l, 0) / 14;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi = 100 - (100 / (1 + rs));
  }

  // Support and Resistance levels
  const recentPrices = prices.slice(-20);
  const support = lowestPrice + (currentPrice - lowestPrice) * 0.1;
  const resistance = currentPrice + (highestPrice - currentPrice) * 0.1;

  // Trading signals
  const isBullish = currentPrice > (sma7 || currentPrice) && priceChangePercent > 0;
  const isBearish = currentPrice < (sma7 || currentPrice) && priceChangePercent < 0;
  const isOversold = rsi !== null && rsi < 30;
  const isOverbought = rsi !== null && rsi > 70;

  // Generate trading suggestions
  const tradingSuggestions = generateTradingSuggestions({
    currentPrice,
    sma7,
    sma30,
    rsi,
    support,
    resistance,
    volatility,
    priceChangePercent,
    isBullish,
    isBearish,
    isOversold,
    isOverbought,
    highestPrice,
    lowestPrice
  });

  return {
    summary: {
      currentPrice,
      currentPriceFormatted: `$${currentPrice.toFixed(6)}`,
      firstPrice,
      highestPrice,
      lowestPrice,
      priceChange,
      priceChangePercent: priceChangePercent.toFixed(2) + '%',
      totalVolume,
      avgVolume,
      volatility: volatility.toFixed(2) + '%'
    },
    movingAverages: {
      sma7,
      sma30,
      signal: currentPrice > (sma7 || currentPrice) ? 'Above SMA7' : 'Below SMA7'
    },
    indicators: {
      rsi: rsi ? rsi.toFixed(2) : null,
      rsiSignal: isOversold ? 'Oversold' : isOverbought ? 'Overbought' : 'Neutral'
    },
    levels: {
      support: support.toFixed(8),
      resistance: resistance.toFixed(8),
      currentPosition: ((currentPrice - support) / (resistance - support) * 100).toFixed(0) + '% from support'
    },
    trend: {
      direction: priceChangePercent > 5 ? 'Bullish' : 
                priceChangePercent < -5 ? 'Bearish' : 'Sideways',
      strength: Math.abs(priceChangePercent) > 20 ? 'Strong' :
               Math.abs(priceChangePercent) > 10 ? 'Moderate' : 'Weak'
    },
    tradingSuggestions
  };
}

/**
 * Generate trading suggestions based on technical indicators
 */
function generateTradingSuggestions(indicators: any) {
  const suggestions = {
    action: 'HOLD',
    entryPrice: null as number | null,
    stopLoss: null as number | null,
    takeProfit: null as number | null,
    reasoning: [] as string[],
    risk: 'Medium'
  };

  const { 
    currentPrice, 
    sma7, 
    sma30, 
    rsi, 
    support, 
    resistance, 
    volatility,
    priceChangePercent,
    isBullish,
    isBearish,
    isOversold,
    isOverbought,
    highestPrice,
    lowestPrice
  } = indicators;

  // Determine action
  if (isOversold && currentPrice > support) {
    suggestions.action = 'BUY';
    suggestions.reasoning.push('RSI indicates oversold conditions');
    suggestions.reasoning.push('Price near support level');
    suggestions.entryPrice = currentPrice * 1.002; // Slight premium for market order
    suggestions.stopLoss = support * 0.98; // 2% below support
    suggestions.takeProfit = resistance * 0.98; // Just below resistance
    suggestions.risk = 'Low';
  } else if (isOverbought && currentPrice < resistance) {
    suggestions.action = 'SELL';
    suggestions.reasoning.push('RSI indicates overbought conditions');
    suggestions.reasoning.push('Price near resistance level');
    suggestions.risk = 'High';
  } else if (isBullish && sma7 && currentPrice > sma7 * 1.02) {
    suggestions.action = 'BUY';
    suggestions.reasoning.push('Price trending above SMA7');
    suggestions.reasoning.push('Bullish momentum detected');
    suggestions.entryPrice = currentPrice * 1.001;
    suggestions.stopLoss = sma7 * 0.98;
    suggestions.takeProfit = currentPrice * 1.15; // 15% profit target
    suggestions.risk = 'Medium';
  } else if (isBearish && sma7 && currentPrice < sma7 * 0.98) {
    suggestions.action = 'SELL';
    suggestions.reasoning.push('Price trending below SMA7');
    suggestions.reasoning.push('Bearish momentum detected');
    suggestions.risk = 'High';
  } else {
    suggestions.reasoning.push('No clear trading signal');
    suggestions.reasoning.push('Wait for better entry opportunity');
  }

  // Add volatility-based recommendations
  const vol = parseFloat(volatility);
  if (vol > 10) {
    suggestions.reasoning.push(`High volatility (${volatility}%) - use wider stops`);
    if (suggestions.stopLoss) {
      suggestions.stopLoss *= 0.95; // Wider stop for high volatility
    }
  } else if (vol < 3) {
    suggestions.reasoning.push(`Low volatility (${volatility}%) - potential breakout setup`);
  }

  // Format prices
  if (suggestions.entryPrice) suggestions.entryPrice = parseFloat(suggestions.entryPrice.toFixed(8));
  if (suggestions.stopLoss) suggestions.stopLoss = parseFloat(suggestions.stopLoss.toFixed(8));
  if (suggestions.takeProfit) suggestions.takeProfit = parseFloat(suggestions.takeProfit.toFixed(8));

  return suggestions;
}

export const ohlcvDataTool = createTool({
  id: 'cardano-ohlcv-data',
  description: 'Fetch OHLCV (Open, High, Low, Close, Volume) price history data for Cardano tokens with technical analysis',
  inputSchema: z.object({
    token: z.string().describe('Token ticker symbol or policy ID'),
    interval: z.enum(VALID_INTERVALS).default('1d').describe('Time interval for candles (3m, 5m, 15m, 30m, 1h, 2h, 4h, 12h, 1d, 3d, 1w, 1M)'),
    numIntervals: z.number().min(1).max(1000).default(30).describe('Number of intervals to fetch (max 1000)'),
    includeTechnicals: z.boolean().default(true).describe('Whether to include technical analysis'),
    format: z.enum(['raw', 'chart', 'summary']).default('chart').describe('Output format preference')
  }),
  execute: async ({ context: { token, interval, numIntervals, includeTechnicals, format } }) => {
    try {
      console.log(`📈 Fetching OHLCV data for: ${token} (${interval}, ${numIntervals} intervals)`);
      
      // Step 1: Determine if token is already a unit/policy ID or needs resolution
      let unit: string;
      let tokenData: any = {};
      
      // Check if it's already a policy ID or unit (56+ hex characters)
      if (/^[a-f0-9]{56,}$/i.test(token)) {
        // It's already a unit/policy ID, use it directly
        unit = token;
        tokenData = {
          ticker: 'TOKEN',
          name: 'Token',
          unit: token,
          policy_id: token.length === 56 ? token : token.substring(0, 56),
          decimals: 0
        };
        console.log(`📍 Using provided unit directly: ${unit}`);
      } else {
        // It's a ticker: resolve via our DB-backed tool (with TapTools fallback inside)
        try {
          const mod: any = await import('./ticker-to-unit');
          const tickerResult: any = await (mod.tickerToUnitTool as any).execute({
            context: { ticker: token, searchLimit: 10 },
            runtimeContext: new RuntimeContext(),
          });
          if (tickerResult?.success && tickerResult.data?.unit) {
            unit = tickerResult.data.unit as string;
            tokenData = {
              ticker: tickerResult.data.ticker || token,
              name: tickerResult.data.name || 'Unknown',
              unit: tickerResult.data.unit,
              policy_id: tickerResult.data.policy_id || tickerResult.data.policyId,
              decimals: tickerResult.data.decimals || 0,
            } as any;
            console.log(`✅ Token resolved via tickerToUnitTool: ${tokenData.name} (${tokenData.ticker})`);
          } else {
            // Try comprehensive search as last resort
            const mod2: any = await import('./comprehensive-token-search');
            const search: any = await (mod2.comprehensiveTokenSearchTool as any).execute({
              context: { query: token, maxResults: 3 },
              runtimeContext: new RuntimeContext(),
            });
            const first = search?.data?.tokens?.[0];
            if (first?.unit) {
              unit = first.unit;
              tokenData = {
                ticker: first.ticker || token,
                name: first.name || 'Unknown',
                unit: first.unit,
                policy_id: first.policyId || first.policy_id,
                decimals: first.decimals || 0,
              };
              console.log(`✅ Token resolved via comprehensive search: ${tokenData.name} (${tokenData.ticker})`);
            } else {
              return {
                success: false,
                error: 'Token not found',
                message: `Could not find token information for: ${token}`,
                suggestions: [
                  'Check the ticker symbol or policy ID',
                  'Ensure the token exists on Cardano',
                  'Try using the full policy ID instead of ticker',
                ],
              };
            }
          }
        } catch (err) {
          return {
            success: false,
            error: 'Token resolution failed',
            message: `Could not resolve token: ${token}`,
            suggestions: [
              'Check the ticker symbol or policy ID',
              'Ensure the token exists on Cardano',
              'Try using the full policy ID instead of ticker',
            ],
          };
        }
      }

      // Step 2: Get OHLCV data from TapTools
      let ohlcvData: any[] = [];
      if (unit) {
        try {
          ohlcvData = await tapToolsAPI.getTokenOHLCV(unit, interval, numIntervals);
          console.log(`📊 Retrieved ${ohlcvData.length} OHLCV candles`);
        } catch (error) {
          console.warn(`⚠️ Failed to get OHLCV data: ${error}`);
        }
      }

      if (ohlcvData.length === 0) {
        return {
          success: false,
          error: 'No price data available',
          message: `No OHLCV data found for ${tokenData.name}`,
          token: {
            ticker: tokenData.ticker,
            name: tokenData.name,
            policyId: tokenData.policy_id,
            unit: tokenData.unit
          },
          suggestions: [
            'Try a different time interval',
            'Check if the token has sufficient trading history',
            'Verify the token is actively traded'
          ]
        };
      }

      // Step 3: Format data based on requested format
      const formattedData = formatOHLCVData(ohlcvData, tokenData);
      
      // Step 4: Calculate technical indicators if requested
      let technicalAnalysis = null;
      let tapToolsIndicators: Record<string, any> = {};
      
      if (includeTechnicals) {
        // Calculate our own technical indicators
        technicalAnalysis = calculateTechnicalIndicators(formattedData);
        
        // Also fetch TapTools indicators for enhanced analysis
        try {
          const indicators = await tapToolsAPI.getMultipleIndicators(
            tokenData.unit,
            interval,
            ['rsi', 'macd', 'ema', 'bb'],
            Math.min(numIntervals, 100)
          );
          
          // Add TapTools indicators to the analysis
          if (indicators.rsi && indicators.rsi.length > 0) {
            const latestRSI = indicators.rsi[indicators.rsi.length - 1];
            // RSI returns a single value (number) not an object
            tapToolsIndicators.rsi = {
              value: typeof latestRSI === 'number' ? latestRSI : (latestRSI.value || latestRSI.rsi),
              timestamp: new Date().toISOString(),
              history: indicators.rsi
            };
          }
          
          if (indicators.macd && indicators.macd.length > 0) {
            const latestMACD = indicators.macd[indicators.macd.length - 1];
            // MACD returns an object with macd, signal, histogram
            tapToolsIndicators.macd = {
              macd: latestMACD.macd,
              signal: latestMACD.signal,
              histogram: latestMACD.histogram,
              timestamp: latestMACD.time || latestMACD.timestamp || new Date().toISOString(),
              history: indicators.macd
            };
          }
          
          if (indicators.ema && indicators.ema.length > 0) {
            const latestEMA = indicators.ema[indicators.ema.length - 1];
            // EMA returns a single value (number) not an object
            tapToolsIndicators.ema = {
              value: typeof latestEMA === 'number' ? latestEMA : (latestEMA.value || latestEMA.ema),
              timestamp: new Date().toISOString(),
              history: indicators.ema
            };
          }
          
          if (indicators.bb && indicators.bb.length > 0) {
            const latestBB = indicators.bb[indicators.bb.length - 1];
            // BB returns an object with upper, middle, lower
            tapToolsIndicators.bollingerBands = {
              upper: latestBB.upper,
              middle: latestBB.middle,
              lower: latestBB.lower,
              timestamp: latestBB.time || latestBB.timestamp || new Date().toISOString(),
              history: indicators.bb
            };
          }
          
          console.log(`📊 Fetched TapTools indicators: ${Object.keys(tapToolsIndicators).join(', ')}`);
        } catch (error) {
          console.warn(`⚠️ Failed to fetch TapTools indicators: ${error}`);
        }
      }

      // Step 5: Prepare response based on format
      let responseData;
      
      switch (format) {
        case 'raw':
          responseData = {
            token: {
              ticker: tokenData.ticker,
              name: tokenData.name,
              policyId: tokenData.policy_id,
              unit: tokenData.unit
            },
            data: ohlcvData,
            metadata: {
              interval,
              numIntervals: ohlcvData.length,
              dataSource: 'TapTools API'
            }
          };
          break;
          
        case 'summary':
          responseData = {
            token: {
              ticker: tokenData.ticker,
              name: tokenData.name,
              policyId: tokenData.policy_id
            },
            summary: technicalAnalysis?.summary || {},
            trend: technicalAnalysis?.trend || {},
            indicators: {
              calculated: technicalAnalysis?.indicators || {},
              taptools: tapToolsIndicators
            },
            metadata: {
              interval,
              numIntervals: ohlcvData.length,
              dateRange: {
                from: formattedData[0]?.dateFormatted,
                to: formattedData[formattedData.length - 1]?.dateFormatted
              }
            }
          };
          break;
          
        case 'chart':
        default:
          responseData = {
            token: {
              ticker: tokenData.ticker,
              name: tokenData.name,
              policyId: tokenData.policy_id,
              unit: tokenData.unit
            },
            ohlcv: formattedData,
            technicalAnalysis,
            tapToolsIndicators,
            chartConfig: {
              interval,
              numIntervals: formattedData.length,
              dateRange: {
                from: formattedData[0]?.date,
                to: formattedData[formattedData.length - 1]?.date
              },
              priceRange: {
                min: Math.min(...formattedData.map(d => d.low)),
                max: Math.max(...formattedData.map(d => d.high))
              }
            },
            metadata: {
              dataSource: 'TapTools API',
              indicatorSource: Object.keys(tapToolsIndicators).length > 0 ? 'TapTools Indicators API' : 'Calculated',
              generatedAt: new Date().toISOString()
            }
          };
          break;
      }

      return {
        success: true,
        data: responseData,
        message: `OHLCV data retrieved for ${tokenData.name} - ${ohlcvData.length} ${interval} candles`
      };

    } catch (error) {
      console.error(`❌ OHLCV data fetch failed for ${token}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: `Failed to fetch OHLCV data for: ${token}`
      };
    }
  },
});
