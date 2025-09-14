import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { krakenPriceTool } from './kraken-price';
import { coinGeckoAPI } from '../../services/coingecko-api';
import { tickerToUnitTool } from '../cardano/ticker-to-unit';
import { tapToolsAPI } from '../../services/taptools-api';

/**
 * Format market data for display
 */
function formatMarketData(data: any) {
  return {
    name: data.name,
    symbol: data.symbol?.toUpperCase(),
    currentPrice: data.current_price,
    priceFormatted: `$${data.current_price?.toLocaleString() || 'N/A'}`,
    marketCap: data.market_cap,
    marketCapFormatted: `$${data.market_cap?.toLocaleString() || 'N/A'}`,
    marketCapRank: data.market_cap_rank,
    volume24h: data.total_volume,
    volume24hFormatted: `$${data.total_volume?.toLocaleString() || 'N/A'}`,
    priceChange24h: data.price_change_24h,
    priceChangePercent24h: data.price_change_percentage_24h,
    priceChangeFormatted: data.price_change_percentage_24h ? 
      `${data.price_change_percentage_24h > 0 ? '+' : ''}${data.price_change_percentage_24h.toFixed(2)}%` : 'N/A',
    high24h: data.high_24h,
    low24h: data.low_24h,
    ath: data.ath,
    athChangePercent: data.ath_change_percentage,
    athDate: data.ath_date,
    atl: data.atl,
    atlChangePercent: data.atl_change_percentage,
    atlDate: data.atl_date,
    circulatingSupply: data.circulating_supply,
    totalSupply: data.total_supply,
    maxSupply: data.max_supply,
    lastUpdated: data.last_updated
  };
}

/**
 * Analyze market trends
 */
function analyzeMarketTrend(data: any) {
  const priceChange = data.price_change_percentage_24h || 0;
  const marketCapChange = data.market_cap_change_percentage_24h || 0;
  
  let trend = 'Neutral';
  let strength = 'Weak';
  let sentiment = 'Neutral';
  
  // Determine trend direction
  if (priceChange > 5) {
    trend = 'Bullish';
    sentiment = 'Positive';
  } else if (priceChange < -5) {
    trend = 'Bearish';
    sentiment = 'Negative';
  }
  
  // Determine trend strength
  const absChange = Math.abs(priceChange);
  if (absChange > 20) {
    strength = 'Very Strong';
  } else if (absChange > 10) {
    strength = 'Strong';
  } else if (absChange > 5) {
    strength = 'Moderate';
  }
  
  // Market cap vs price analysis
  let marketCapTrend = 'Stable';
  if (Math.abs(marketCapChange - priceChange) > 2) {
    marketCapTrend = marketCapChange > priceChange ? 
      'Supply increasing faster than price' : 
      'Price increasing faster than supply';
  }
  
  return {
    trend,
    strength,
    sentiment,
    priceChange24h: priceChange,
    marketCapChange24h: marketCapChange,
    marketCapTrend,
    analysis: generateTrendAnalysis(priceChange, marketCapChange, data)
  };
}

/**
 * Generate trend analysis text
 */
function generateTrendAnalysis(priceChange: number, marketCapChange: number, data: any): string[] {
  const analysis = [];
  
  if (Math.abs(priceChange) > 10) {
    analysis.push(`Significant ${priceChange > 0 ? 'upward' : 'downward'} price movement of ${Math.abs(priceChange).toFixed(2)}%`);
  }
  
  if (data.market_cap_rank && data.market_cap_rank <= 100) {
    analysis.push(`Ranked #${data.market_cap_rank} by market capitalization`);
  }
  
  if (data.ath_change_percentage && data.ath_change_percentage < -50) {
    analysis.push(`Currently ${Math.abs(data.ath_change_percentage).toFixed(1)}% below all-time high`);
  }
  
  if (data.total_volume && data.market_cap) {
    const volumeToMcapRatio = (data.total_volume / data.market_cap) * 100;
    if (volumeToMcapRatio > 10) {
      analysis.push('High trading volume relative to market cap indicates strong interest');
    } else if (volumeToMcapRatio < 1) {
      analysis.push('Low trading volume relative to market cap');
    }
  }
  
  return analysis;
}

export const marketDataTool = createTool({
  id: 'market-data',
  description: 'FIXED: Get reliable cryptocurrency market data using Kraken API (primary) with CoinGecko fallback',
  inputSchema: z.object({
    query: z.string().describe('Cryptocurrency name, symbol, or CoinGecko ID to search for'),
    includeAnalysis: z.boolean().default(true).describe('Whether to include trend analysis'),
    includeSupplyData: z.boolean().default(true).describe('Whether to include supply information'),
    includeATH: z.boolean().default(true).describe('Whether to include all-time high/low data'),
  }),
  execute: async ({ context: { query, includeAnalysis, includeSupplyData, includeATH } }) => {
    try {
      console.log(`🔧 [FIXED] Fetching market data for: ${query}`);
      
      // Step 1: Check if this is a Kraken-supported L1 token
      const krakenSymbols = extractKrakenSymbols(query);
      let primaryData = null;
      let dataSource = 'CoinGecko';

      // Step 2: If NOT a Kraken symbol, try Cardano token lookup first
      if (krakenSymbols.length === 0) {
        console.log(`🪙 Checking if ${query} is a Cardano native token...`);
        
        try {
          // Try to resolve as Cardano token
          const { RuntimeContext } = await import('@mastra/core/runtime-context');
          const tokenResult: any = await (tickerToUnitTool as any).execute({
            context: { ticker: query, searchLimit: 10 },
            runtimeContext: new RuntimeContext(),
          });
          
          if (tokenResult?.success && tokenResult.data?.unit) {
            console.log(`✅ Found Cardano token: ${tokenResult.data.ticker} (${tokenResult.data.unit})`);
            
            // Get price from TapTools
            try {
              const priceData = await tapToolsAPI.getTokenPrice(tokenResult.data.unit);
              
              if (priceData && priceData.price) {
                const formattedData = {
                  id: tokenResult.data.ticker?.toLowerCase() || query.toLowerCase(),
                  name: tokenResult.data.name || tokenResult.data.ticker || query,
                  symbol: tokenResult.data.ticker || query.toUpperCase(),
                  
                  // Price data from TapTools
                  currentPrice: priceData.price,
                  priceFormatted: `$${priceData.price.toFixed(6)}`,
                  
                  // Volume from TapTools
                  volume24h: priceData.volume || 0,
                  volume24hFormatted: `$${(priceData.volume || 0).toLocaleString()}`,
                  
                  // Market cap
                  marketCap: priceData.marketCap || (priceData.price * (tokenResult.data.supply || 0)),
                  marketCapFormatted: `$${(priceData.marketCap || 0).toLocaleString()}`,
                  
                  // Price changes
                  priceChange24h: priceData.priceChange24h || 0,
                  priceChangePercent24h: priceData.priceChange24hPercent || 0,
                  priceChangeFormatted: `${(priceData.priceChange24hPercent || 0) >= 0 ? '+' : ''}${(priceData.priceChange24hPercent || 0).toFixed(2)}%`,
                  
                  // Supply data from token info
                  circulatingSupply: tokenResult.data.supply || 0,
                  decimals: tokenResult.data.decimals || 0,
                  
                  // Cardano specific
                  policyId: tokenResult.data.policy_id,
                  assetName: tokenResult.data.asset_name,
                  unit: tokenResult.data.unit,
                  
                  lastUpdated: new Date().toISOString()
                };
                
                return {
                  success: true,
                  data: {
                    coin: formattedData,
                    metadata: {
                      source: 'TapTools API (Cardano Native Token)',
                      dataFreshness: 'Real-time',
                      lastUpdated: new Date().toISOString(),
                      provider: 'TapTools',
                      isCardanoNative: true
                    }
                  },
                  message: `Market data retrieved for Cardano native token ${formattedData.name} (${formattedData.symbol})`
                };
              }
            } catch (tapToolsError) {
              console.log(`⚠️ TapTools price fetch failed for ${tokenResult.data?.unit}, will fallback to CoinGecko`);
            }
          }
        } catch (tokenError) {
          console.log(`ℹ️ Not a Cardano token or not found in database: ${query}`);
        }
      }

      // Step 3: Try Kraken for L1 tokens
      if (krakenSymbols.length > 0) {
        console.log(`📊 Using Kraken API for symbols: ${krakenSymbols.join(', ')}`);
        const { RuntimeContext } = await import('@mastra/core/runtime-context');
        const krakenResult: any = await (krakenPriceTool as any).execute({
          context: { symbols: krakenSymbols, pairs: [] },
          runtimeContext: new RuntimeContext(),
        });

        if (krakenResult?.success && krakenResult.data?.results?.length > 0) {
          // Use Kraken data as primary source
          primaryData = krakenResult.data.results[0];
          dataSource = 'Kraken';
          
          const formattedData = {
            id: primaryData.symbol.toLowerCase(),
            name: getFullCryptoName(primaryData.symbol),
            symbol: primaryData.symbol,
            
            // Price data from Kraken
            currentPrice: primaryData.price,
            priceFormatted: `$${primaryData.price.toFixed(primaryData.symbol === 'BTC' ? 2 : 6)}`,
            
            // Volume from Kraken
            volume24h: primaryData.volume24h * primaryData.price, // Convert to USD
            volume24hFormatted: `$${(primaryData.volume24h * primaryData.price).toLocaleString()}`,
            
            // Price changes
            priceChange24h: primaryData.change24h,
            priceChangePercent24h: ((primaryData.change24h / (primaryData.price - primaryData.change24h)) * 100),
            priceChangeFormatted: `${primaryData.change24h >= 0 ? '+' : ''}${((primaryData.change24h / (primaryData.price - primaryData.change24h)) * 100).toFixed(2)}%`,
            
            // 24h range
            high24h: primaryData.high24h,
            low24h: primaryData.low24h,
            
            lastUpdated: new Date(primaryData.timestamp).toISOString()
          };

          // Generate trend analysis if requested
          let trendAnalysis = null;
          if (includeAnalysis) {
            trendAnalysis = analyzeKrakenTrend(primaryData);
          }

          return {
            success: true,
            data: {
              coin: formattedData,
              ...(trendAnalysis && { analysis: trendAnalysis }),
              metadata: {
                source: 'Kraken API (Primary)',
                dataFreshness: 'Real-time',
                lastUpdated: new Date().toISOString(),
                provider: 'Kraken'
              }
            },
            message: `Market data retrieved for ${formattedData.name} (${formattedData.symbol}) from Kraken`
          };
        }
      }

      // Step 4: Fallback to CoinGecko for tokens not on Kraken or TapTools
      console.log(`📊 Using CoinGecko API fallback for: ${query}`);
      const searchResults = await coinGeckoAPI.searchCoins(query);
      
      if (searchResults.length === 0) {
        return {
          success: false,
          error: 'Cryptocurrency not found',
          message: `Could not find cryptocurrency: ${query}`,
          suggestions: [
            'Check the spelling of the cryptocurrency name or symbol',
            'Try using the full name instead of symbol',
            'Major cryptocurrencies (BTC, ETH, ADA, SOL) use reliable Kraken data'
          ]
        };
      }

      // Get the best match (first result)
      const coin = searchResults[0];
      console.log(`✅ Found cryptocurrency: ${coin.name} (${coin.symbol}) via CoinGecko`);

      // Get detailed market data from CoinGecko
      const coinData = await coinGeckoAPI.getCoinData(coin.id);
      
      if (!coinData || !coinData.market_data) {
        return {
          success: false,
          error: 'Market data not available',
          message: `Market data not found for ${coin.name}`,
        };
      }

      // Format CoinGecko data (original logic)
      const marketData = coinData.market_data;
      const formattedData = {
        id: coinData.id,
        name: coinData.name,
        symbol: coinData.symbol?.toUpperCase(),
        description: coinData.description?.en?.substring(0, 200) + '...' || 'No description available',
        
        // Price data
        currentPrice: marketData.current_price?.usd,
        priceFormatted: `$${marketData.current_price?.usd?.toLocaleString() || 'N/A'}`,
        
        // Market data
        marketCap: marketData.market_cap?.usd,
        marketCapFormatted: `$${marketData.market_cap?.usd?.toLocaleString() || 'N/A'}`,
        marketCapRank: marketData.market_cap_rank,
        
        // Volume
        volume24h: marketData.total_volume?.usd,
        volume24hFormatted: `$${marketData.total_volume?.usd?.toLocaleString() || 'N/A'}`,
        
        // Price changes
        priceChange24h: marketData.price_change_24h,
        priceChangePercent24h: marketData.price_change_percentage_24h,
        priceChangeFormatted: marketData.price_change_percentage_24h ? 
          `${marketData.price_change_percentage_24h > 0 ? '+' : ''}${marketData.price_change_percentage_24h.toFixed(2)}%` : 'N/A',
        
        // 24h range
        high24h: marketData.high_24h?.usd,
        low24h: marketData.low_24h?.usd,
        
        // Additional data based on options
        ...(includeATH && {
          ath: marketData.ath?.usd,
          athChangePercent: marketData.ath_change_percentage?.usd,
          athDate: marketData.ath_date?.usd,
          atl: marketData.atl?.usd,
          atlChangePercent: marketData.atl_change_percentage?.usd,
          atlDate: marketData.atl_date?.usd,
        }),
        
        ...(includeSupplyData && {
          circulatingSupply: marketData.circulating_supply,
          totalSupply: marketData.total_supply,
          maxSupply: marketData.max_supply,
          circulatingSupplyFormatted: marketData.circulating_supply?.toLocaleString(),
          totalSupplyFormatted: marketData.total_supply?.toLocaleString(),
          maxSupplyFormatted: marketData.max_supply?.toLocaleString() || 'No limit',
        }),
        
        lastUpdated: coinData.last_updated
      };

      // Generate trend analysis if requested
      let trendAnalysis = null;
      if (includeAnalysis) {
        trendAnalysis = analyzeMarketTrend(marketData);
      }

      // Prepare response
      const response = {
        coin: formattedData,
        ...(trendAnalysis && { analysis: trendAnalysis }),
        metadata: {
          source: 'CoinGecko API (Fallback)',
          dataFreshness: 'Real-time',
          lastUpdated: new Date().toISOString(),
          coinGeckoId: coin.id
        }
      };

      return {
        success: true,
        data: response,
        message: `Market data retrieved for ${coinData.name} (${coinData.symbol?.toUpperCase()}) from CoinGecko fallback`
      };

    } catch (error) {
      console.error(`❌ Market data fetch failed for ${query}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: `Failed to fetch market data for: ${query}`
      };
    }
  },
});

/**
 * Extract Kraken-supported symbols from query
 */
function extractKrakenSymbols(query: string): string[] {
  const krakenSupported = ['BTC', 'ETH', 'ADA', 'SOL', 'SUI', 'AVAX', 'DOT', 'MATIC', 'ATOM', 'LINK', 'UNI', 'LTC', 'BCH', 'XRP', 'DOGE', 'SHIB', 'TRX', 'TON', 'XLM', 'ALGO', 'VET', 'ICP', 'FIL', 'HBAR', 'APT', 'NEAR', 'OP', 'ARB', 'IMX', 'STX'];
  
  const symbolMap: Record<string, string> = {
    'bitcoin': 'BTC',
    'ethereum': 'ETH',
    'cardano': 'ADA',
    'solana': 'SOL',
    'sui': 'SUI',
    'avalanche': 'AVAX',
    'polkadot': 'DOT',
    'polygon': 'MATIC',
    'cosmos': 'ATOM',
    'chainlink': 'LINK',
    'uniswap': 'UNI',
    'litecoin': 'LTC',
    'bitcoin cash': 'BCH',
    'ripple': 'XRP',
    'dogecoin': 'DOGE',
    'shiba': 'SHIB',
    'shiba inu': 'SHIB',
    'tron': 'TRX',
    'stellar': 'XLM',
    'algorand': 'ALGO',
    'vechain': 'VET',
    'internet computer': 'ICP',
    'filecoin': 'FIL',
    'hedera': 'HBAR',
    'aptos': 'APT',
    'near': 'NEAR',
    'optimism': 'OP',
    'arbitrum': 'ARB',
    'immutable': 'IMX',
    'stacks': 'STX'
  };

  const queryLower = query.toLowerCase().trim();
  const found: string[] = [];

  // Direct EXACT symbol matches only (not partial)
  const queryUpper = query.toUpperCase().trim();
  if (krakenSupported.includes(queryUpper)) {
    found.push(queryUpper);
    return found; // If exact match, return immediately
  }

  // Check for exact name matches from the map
  if (symbolMap[queryLower]) {
    const mappedSymbol = symbolMap[queryLower];
    if (krakenSupported.includes(mappedSymbol)) {
      found.push(mappedSymbol);
      return found;
    }
  }

  // Only for multi-word queries, check if it contains a full name
  if (query.includes(' ')) {
    for (const [name, symbol] of Object.entries(symbolMap)) {
      // Must be exact match or surrounded by word boundaries
      const regex = new RegExp(`\\b${name}\\b`, 'i');
      if (regex.test(query) && krakenSupported.includes(symbol) && !found.includes(symbol)) {
        found.push(symbol);
      }
    }
  }

  return [...new Set(found)];
}

/**
 * Get full cryptocurrency name from symbol
 */
function getFullCryptoName(symbol: string): string {
  const nameMap: Record<string, string> = {
    'BTC': 'Bitcoin',
    'ETH': 'Ethereum',
    'ADA': 'Cardano',
    'SOL': 'Solana',
    'SUI': 'Sui',
    'AVAX': 'Avalanche',
    'DOT': 'Polkadot',
    'MATIC': 'Polygon',
    'ATOM': 'Cosmos',
    'LINK': 'Chainlink',
    'UNI': 'Uniswap',
    'LTC': 'Litecoin',
    'BCH': 'Bitcoin Cash',
    'XRP': 'XRP',
    'DOGE': 'Dogecoin',
    'SHIB': 'Shiba Inu'
  };
  
  return nameMap[symbol] || symbol;
}

/**
 * Analyze market trend from Kraken data
 */
function analyzeKrakenTrend(data: any) {
  const priceChange = data.change24h || 0;
  const price = data.price || 0;
  
  let trend = 'Neutral';
  let strength = 'Weak';
  let sentiment = 'Neutral';
  
  const priceChangePercent = price > 0 ? (priceChange / (price - priceChange)) * 100 : 0;
  
  // Determine trend direction
  if (priceChangePercent > 5) {
    trend = 'Bullish';
    sentiment = 'Positive';
  } else if (priceChangePercent < -5) {
    trend = 'Bearish';
    sentiment = 'Negative';
  }
  
  // Determine trend strength
  const absChange = Math.abs(priceChangePercent);
  if (absChange > 20) {
    strength = 'Very Strong';
  } else if (absChange > 10) {
    strength = 'Strong';
  } else if (absChange > 5) {
    strength = 'Moderate';
  }
  
  const analysis = [];
  if (Math.abs(priceChangePercent) > 10) {
    analysis.push(`Significant ${priceChangePercent > 0 ? 'upward' : 'downward'} price movement of ${Math.abs(priceChangePercent).toFixed(2)}%`);
  }
  
  const volumeToPrice = data.volume24h || 0;
  if (volumeToPrice > 1000000) {
    analysis.push('High trading volume indicates strong market interest');
  }
  
  return {
    trend,
    strength,
    sentiment,
    priceChange24h: priceChangePercent,
    analysis
  };
}
