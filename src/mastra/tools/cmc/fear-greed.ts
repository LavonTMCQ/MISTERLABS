import { z } from 'zod';
import { createTool } from "@mastra/core/tools";

const CMC_API_KEY = process.env.CMC_API_KEY || process.env.COINMARKETCAP_API_KEY || '';
const CMC_BASE_URL = "https://pro-api.coinmarketcap.com/v3";

// Cache for fear and greed data
const fearAndGreedCache = new Map<string, { data: any; timestamp: number }>();

interface FearAndGreedData {
  timestamp: string;
  value: number;
  value_classification: 'Extreme Fear' | 'Fear' | 'Neutral' | 'Greed' | 'Extreme Greed';
}

// Schema for fear and greed data
const FearAndGreedSchema = z.object({
  timestamp: z.string(),
  value: z.number(),
  value_classification: z.enum(['Extreme Fear', 'Fear', 'Neutral', 'Greed', 'Extreme Greed'])
});

// Helper to fetch data from CMC
async function fetchFromCMC(endpoint: string, params: Record<string, string | number> = {}) {
  if (!CMC_API_KEY) {
    throw new Error('CMC API key not configured. Set CMC_API_KEY in your environment.');
  }
  const url = new URL(`${CMC_BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value.toString()));

  console.log('Fetching from CMC:', {
    url: url.toString(),
    headers: {
      'X-CMC_PRO_API_KEY': CMC_API_KEY,
      'Accept': 'application/json'
    },
    params
  });

  const response = await fetch(url.toString(), {
    headers: {
      'X-CMC_PRO_API_KEY': CMC_API_KEY,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    console.error('CMC API Error:', {
      status: response.status,
      statusText: response.statusText,
      errorData
    });
    throw new Error(`CMC API request failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data;
}

// Get fear and greed data
async function getFearAndGreed(limit: number = 1): Promise<FearAndGreedData[]> {
  const cacheKey = limit.toString();
  const cached = fearAndGreedCache.get(cacheKey);

  // Use 15-second cache as per CMC's update frequency
  if (cached && Date.now() - cached.timestamp < 15000) {
    return cached.data;
  }

  const data = await fetchFromCMC('/fear-and-greed/historical', {
    limit,
    start: 1
  });

  // Normalize the value_classification to match the expected enum values
  // This handles case sensitivity issues (e.g., "Extreme fear" → "Extreme Fear")
  if (Array.isArray(data)) {
    data.forEach(item => {
      if (item.value_classification) {
        // Make first letter of each word uppercase
        item.value_classification = item.value_classification
          .split(' ')
          .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
      }
    });
  }

  fearAndGreedCache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}

export const CMCfearandgreed = createTool({
  id: "CoinMarketCap Fear and Greed Index",
  description: "Fetches the CMC Crypto Fear and Greed Index data, indicating market sentiment.",
  inputSchema: z.object({
    limit: z.number().min(1).max(500).optional().default(1).describe('Number of historical data points to fetch'),
    includeAnalysis: z.boolean().optional().default(false).describe('Include sentiment analysis with the data')
  }),
  async execute({ context: { limit = 1, includeAnalysis = false } }) {
    try {
      const data = await getFearAndGreed(limit);

      // Parse and validate the most recent data point
      const latestData = FearAndGreedSchema.parse(data[0]);

      const response: any = {
        current: {
          value: latestData.value,
          classification: latestData.value_classification,
          timestamp: latestData.timestamp
        },
        cacheInfo: {
          dataAge: Math.round((Date.now() - (fearAndGreedCache.get(limit.toString())?.timestamp || 0)) / 1000) + 's'
        }
      };

      if (limit > 1) {
        response.historical = data.slice(1).map(point => ({
          value: point.value,
          classification: point.value_classification,
          timestamp: point.timestamp
        }));
      }

      if (includeAnalysis) {
        response.analysis = {
          trend: determineTrend(data),
          marketImplication: getMarketImplication(latestData.value_classification),
          suggestion: getSuggestion(latestData.value_classification)
        };
      }

      return response;
    } catch (error) {
      console.error('Error in CMCfearandgreed tool:', error);
      throw error;
    }
  }
});

// Helper functions for analysis
function determineTrend(data: FearAndGreedData[]): string {
  if (data.length < 2) return 'Insufficient data for trend analysis';

  const values = data.map(d => d.value);
  const latestValue = values[0];
  const previousValue = values[1];

  const difference = latestValue - previousValue;
  if (Math.abs(difference) < 5) return 'Stable';
  return difference > 0 ? 'Increasing' : 'Decreasing';
}

function getMarketImplication(classification: string): string {
  switch (classification) {
    case 'Extreme Fear':
      return 'Market may be oversold, potential buying opportunity';
    case 'Fear':
      return 'Cautious market sentiment, watch for reversal signals';
    case 'Neutral':
      return 'Balanced market sentiment, monitor for directional moves';
    case 'Greed':
      return 'Market may be overbought, exercise caution';
    case 'Extreme Greed':
      return 'High risk of market correction, consider taking profits';
    default:
      return 'Unknown market sentiment';
  }
}

function getSuggestion(classification: string): string {
  switch (classification) {
    case 'Extreme Fear':
      return 'Consider accumulating positions while maintaining risk management';
    case 'Fear':
      return 'Watch for positive momentum shifts and potential entry points';
    case 'Neutral':
      return 'Maintain balanced portfolio and normal position sizing';
    case 'Greed':
      return 'Consider reducing position sizes and tightening stop losses';
    case 'Extreme Greed':
      return 'Consider taking profits and reducing exposure';
    default:
      return 'Maintain normal trading strategy';
  }
}
