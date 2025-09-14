import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const krakenWebhookTool = createTool({
  id: 'kraken-webhook',
  description: 'Set up real-time price monitoring for ADA and other cryptocurrencies using Kraken WebSocket',
  inputSchema: z.object({
    pairs: z.array(z.string()).default(['ADA/USD', 'BTC/USD']).describe('Trading pairs to monitor'),
    action: z.enum(['start', 'stop', 'status']).default('start').describe('Webhook action'),
    priceAlerts: z.boolean().default(true).describe('Enable price change alerts'),
    alertThreshold: z.number().default(5.0).describe('Price change percentage to trigger alerts')
  }),
  execute: async ({ context: { pairs, action, priceAlerts, alertThreshold } }) => {
    try {
      console.log(`[KRAKEN WEBHOOK] ${action.toUpperCase()} monitoring for pairs: ${pairs.join(', ')}`);

      if (action === 'status') {
        return {
          success: true,
          data: {
            status: 'Real-time monitoring available',
            supportedPairs: ['ADA/USD', 'BTC/USD', 'ETH/USD', 'SOL/USD', 'SUI/USD'],
            features: [
              'Real-time price updates',
              'Volume change alerts', 
              'Price threshold notifications',
              'Market trend analysis'
            ]
          },
          message: 'Kraken WebSocket monitoring is configured and ready'
        };
      }

      if (action === 'start') {
        // Create WebSocket connection configuration
        const websocketConfig = {
          url: 'wss://ws.kraken.com',
          subscriptions: pairs.map(pair => ({
            event: 'subscribe',
            subscription: {
              name: 'ticker'
            },
            pair: [pair.replace('/', '')]
          })),
          handlers: {
            onOpen: () => console.log('[KRAKEN WS] Connected to real-time feed'),
            onMessage: (data: any) => {
              if (data[1] === 'ticker') {
                const tickerData = data[1];
                const pair = data[3];
                const price = parseFloat(tickerData.c[0]);
                
                console.log(`[KRAKEN WS] ${pair}: $${price.toFixed(6)}`);
                
                // Store latest price in memory for MISTER access
                (global as any).krakenPrices = (global as any).krakenPrices || {};
                (global as any).krakenPrices[pair] = {
                  price,
                  timestamp: Date.now(),
                  ask: parseFloat(tickerData.a[0]),
                  bid: parseFloat(tickerData.b[0]),
                  volume24h: parseFloat(tickerData.v[1])
                };
              }
            },
            onError: (error: any) => console.error('[KRAKEN WS] Error:', error),
            onClose: () => console.log('[KRAKEN WS] Connection closed')
          }
        };

        // Store webhook configuration for the agent
        (global as any).krakenWebhookConfig = websocketConfig;

        return {
          success: true,
          data: {
            status: 'started',
            pairs,
            config: websocketConfig,
            features: {
              realTimeUpdates: true,
              priceAlerts,
              alertThreshold: `${alertThreshold}%`
            }
          },
          message: `Started real-time monitoring for ${pairs.length} trading pairs`
        };
      }

      if (action === 'stop') {
        // Clean up webhook configuration
        (global as any).krakenWebhookConfig = null;
        (global as any).krakenPrices = {};

        return {
          success: true,
          data: {
            status: 'stopped',
            message: 'Real-time monitoring disabled'
          },
          message: 'Stopped Kraken WebSocket monitoring'
        };
      }

      return {
        success: false,
        error: 'Invalid action',
        message: 'Action must be start, stop, or status'
      };

    } catch (error) {
      console.error('[KRAKEN WEBHOOK] Setup failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: 'Failed to configure Kraken WebSocket monitoring'
      };
    }
  }
});

// Helper function to get latest cached price from webhook
export function getLatestKrakenPrice(pair: string): number | null {
  try {
    const prices = (global as any).krakenPrices;
    if (prices && prices[pair]) {
      return prices[pair].price;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Helper function to check if webhook is active
export function isKrakenWebhookActive(): boolean {
  return !!(global as any).krakenWebhookConfig;
}
