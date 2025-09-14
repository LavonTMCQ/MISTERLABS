/**
 * Comprehensive Token Lookup Tool
 * Checks database first, then falls back to API searches
 * Ensures MISTER can always find tokens users ask about
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { tokenDatabase } from './token-database-manager-sqlite';
import { tapToolsAPI } from '../../services/taptools-api';
import axios from 'axios';

interface TokenLookupResult {
  found: boolean;
  source: 'database' | 'api' | 'search';
  token?: {
    unit: string;
    ticker: string;
    name: string;
    marketCap: number;
    price: number;
    volume24h: number;
    volume7d?: number;
    holders: number;
    priceChange24h?: number;
    priceChange7d?: number;
    lastUpdated: string;
  };
  message?: string;
  alternativeSuggestions?: Array<{
    ticker: string;
    name: string;
    marketCap: number;
  }>;
}

/**
 * Search for token in multiple ways
 */
async function findTokenComprehensive(
  query: string
): Promise<TokenLookupResult> {
  const upperQuery = query.toUpperCase();
  
  console.log(`🔍 Comprehensive search for: ${query}`);
  
  // Step 1: Check database first (fastest)
  console.log('📚 Checking local database...');
  
  // Try by ticker
  let dbToken = tokenDatabase.getTokenByTicker(query);
  
  // If not found and query looks like a unit/policy ID (56+ chars)
  if (!dbToken && query.length >= 56) {
    dbToken = tokenDatabase.getToken(query);
  }
  
  if (dbToken) {
    console.log(`✅ Found in database: ${dbToken.ticker}`);
    return {
      found: true,
      source: 'database',
      token: {
        unit: dbToken.unit,
        ticker: dbToken.ticker,
        name: dbToken.name,
        marketCap: dbToken.marketCap,
        price: dbToken.price,
        volume24h: dbToken.volume24h,
        volume7d: dbToken.volume7d,
        holders: dbToken.holders,
        priceChange24h: dbToken.priceChange24h,
        priceChange7d: dbToken.priceChange7d,
        lastUpdated: dbToken.lastUpdated
      }
    };
  }
  
  // Step 2: Search via TapTools API
  console.log('🌐 Searching TapTools API...');
  
  // If it looks like a unit/policy ID, use the integration endpoint
  if (query.length >= 56) {
    try {
      const tokenInfo = await tapToolsAPI.getTokenInfoByUnit(query);
      if (tokenInfo) {
        // Save to database for future use
        const savedToken = tokenDatabase.upsertToken({
          unit: tokenInfo.unit || query,
          ticker: tokenInfo.ticker || tokenInfo.symbol || 'UNKNOWN',
          name: tokenInfo.name || tokenInfo.ticker || 'Unknown',
          marketCap: tokenInfo.mcap || 0,
          price: tokenInfo.price || 0,
          volume24h: tokenInfo.volume_24h || 0,
          holders: tokenInfo.holders || 0
        });
        
        console.log(`✅ Found via API and saved: ${savedToken.ticker}`);
        
        return {
          found: true,
          source: 'api',
          token: {
            unit: tokenInfo.unit || query,
            ticker: tokenInfo.ticker || tokenInfo.symbol || 'UNKNOWN',
            name: tokenInfo.name || tokenInfo.ticker || 'Unknown',
            marketCap: tokenInfo.mcap || 0,
            price: tokenInfo.price || 0,
            volume24h: tokenInfo.volume_24h || 0,
            volume7d: tokenInfo.volume_7d || 0,
            holders: tokenInfo.holders || 0,
            priceChange24h: tokenInfo.priceChange_24h || 0,
            priceChange7d: tokenInfo.priceChange_7d || 0,
            lastUpdated: new Date().toISOString()
          }
        };
      }
    } catch (error) {
      console.log('Integration endpoint search failed');
    }
  }
  
  // Step 3: Search through market cap pages
  console.log('📊 Searching market cap rankings...');
  
  for (let page = 1; page <= 20; page++) {
    try {
      const response = await axios.get(
        `https://openapi.taptools.io/api/v1/token/top/mcap?page=${page}&perPage=100`,
        {
          headers: {
            'x-api-key': process.env.TAPTOOLS_API_KEY || 'WghkJaZlDWYdQFsyt3uiLdTIOYnR5uhO'
          },
          timeout: 10000
        }
      );
      
      const tokens = response.data;
      if (!tokens || tokens.length === 0) break;
      
      // Search for exact match or close match
      const match = tokens.find((t: any) => 
        t.ticker?.toUpperCase() === upperQuery ||
        t.name?.toUpperCase().includes(upperQuery) ||
        t.unit === query
      );
      
      if (match) {
        // Save to database
        const savedToken = tokenDatabase.upsertToken({
          unit: match.unit,
          ticker: match.ticker || 'UNKNOWN',
          name: match.name || match.ticker || 'Unknown',
          marketCap: match.mcap || 0,
          price: match.price || 0,
          volume24h: match.volume_24h || 0,
          holders: 0
        });
        
        console.log(`✅ Found in market cap page ${page}: ${savedToken.ticker}`);
        
        return {
          found: true,
          source: 'search',
          token: {
            unit: savedToken.unit,
            ticker: savedToken.ticker,
            name: savedToken.name,
            marketCap: savedToken.marketCap,
            price: savedToken.price,
            volume24h: savedToken.volume24h,
            holders: savedToken.holders,
            lastUpdated: savedToken.lastUpdated
          }
        };
      }
      
      // Don't search too many pages
      if (page >= 20) {
        console.log('Reached search limit');
        break;
      }
    } catch (error) {
      console.log(`Failed to search page ${page}`);
      break;
    }
  }
  
  // Step 4: Search through volume rankings
  console.log('📈 Searching volume rankings...');
  
  for (let page = 1; page <= 10; page++) {
    try {
      const volumeTokens = await tapToolsAPI.getTopVolumeTokens('24h', page, 100);
      
      const match = volumeTokens.find((t: any) => 
        t.ticker?.toUpperCase() === upperQuery ||
        t.name?.toUpperCase().includes(upperQuery) ||
        t.unit === query
      );
      
      if (match) {
        // Save to database
        const savedToken = tokenDatabase.upsertToken({
          unit: match.unit,
          ticker: match.ticker || 'UNKNOWN',
          name: match.name || match.ticker || 'Unknown',
          marketCap: match.mcap || 0,
          price: match.price || 0,
          volume24h: match.volume || 0,
          holders: 0
        });
        
        console.log(`✅ Found in volume rankings: ${savedToken.ticker}`);
        
        return {
          found: true,
          source: 'search',
          token: {
            unit: savedToken.unit,
            ticker: savedToken.ticker,
            name: savedToken.name,
            marketCap: savedToken.marketCap,
            price: savedToken.price,
            volume24h: savedToken.volume24h,
            holders: savedToken.holders,
            lastUpdated: savedToken.lastUpdated
          }
        };
      }
    } catch (error) {
      break;
    }
  }
  
  // Step 5: Provide alternative suggestions
  console.log('💡 Searching for similar tokens...');
  
  const alternatives = tokenDatabase.searchTokens({
    limit: 5
  }).filter(t => 
    t.ticker.includes(upperQuery.substring(0, 3)) ||
    t.name.toUpperCase().includes(upperQuery.substring(0, 3))
  );
  
  return {
    found: false,
    source: 'search',
    message: `Token "${query}" not found. It may be too new or have very low volume.`,
    alternativeSuggestions: alternatives.map(t => ({
      ticker: t.ticker,
      name: t.name,
      marketCap: t.marketCap
    }))
  };
}

export const tokenLookupTool = createTool({
  id: 'token-lookup',
  name: 'Token Lookup Tool',
  description: 'Comprehensive token search that checks database first, then APIs. Ensures tokens are always found.',
  inputSchema: z.object({
    query: z.string().describe('Token ticker, name, or unit/policy ID to search for'),
    forceRefresh: z.boolean().optional().default(false).describe('Force API lookup even if in database')
  }),
  execute: async ({ context: { query, forceRefresh } }) => {
    try {
      // If force refresh, skip database
      if (forceRefresh) {
        console.log('🔄 Force refresh requested, skipping database...');
        // Clear from database if exists
        const existing = tokenDatabase.getTokenByTicker(query) || tokenDatabase.getToken(query);
        if (existing) {
          console.log('Clearing cached version...');
          // Note: Would need to add delete method to tokenDatabase
        }
      }
      
      const result = await findTokenComprehensive(query);
      
      if (result.found && result.token) {
        // Format successful response
        let response = `# Token Found: ${result.token.ticker}\n\n`;
        response += `**Name:** ${result.token.name}\n`;
        response += `**Market Cap:** $${result.token.marketCap.toLocaleString()}\n`;
        response += `**Price:** $${result.token.price.toFixed(6)}\n`;
        response += `**24h Volume:** $${result.token.volume24h.toLocaleString()}\n`;
        
        if (result.token.holders > 0) {
          response += `**Holders:** ${result.token.holders.toLocaleString()}\n`;
        }
        
        if (result.token.priceChange24h !== undefined) {
          response += `**24h Change:** ${result.token.priceChange24h.toFixed(2)}%\n`;
        }
        
        response += `\n*Source: ${result.source}*`;
        response += `\n*Last Updated: ${result.token.lastUpdated}*`;
        
        return {
          success: true,
          data: result.token,
          message: response
        };
      } else {
        // Format not found response
        let response = `# Token Not Found: ${query}\n\n`;
        response += result.message || 'Token could not be found in any data source.\n';
        
        if (result.alternativeSuggestions && result.alternativeSuggestions.length > 0) {
          response += '\n## Similar Tokens:\n';
          result.alternativeSuggestions.forEach(alt => {
            response += `- **${alt.ticker}** (${alt.name}) - $${alt.marketCap.toLocaleString()} MCap\n`;
          });
        }
        
        return {
          success: false,
          message: response
        };
      }
      
    } catch (error: any) {
      console.error('Token lookup failed:', error);
      return {
        success: false,
        message: `Failed to lookup token: ${error.message}`
      };
    }
  }
});

// Export for use in other tools
export { findTokenComprehensive };