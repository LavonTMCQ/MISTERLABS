import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import WebSocket from 'ws';
import { EventEmitter } from 'events';

// Price monitoring system with WebSocket feeds
class PriceMonitor extends EventEmitter {
  private static instance: PriceMonitor;
  private connections: Map<string, WebSocket> = new Map();
  private priceCache: Map<string, PriceData> = new Map();
  private alerts: Map<string, Alert[]> = new Map();
  private isActive = false;

  static getInstance(): PriceMonitor {
    if (!PriceMonitor.instance) {
      PriceMonitor.instance = new PriceMonitor();
    }
    return PriceMonitor.instance;
  }

  private constructor() {
    super();
    this.setupCleanup();
  }

  private setupCleanup() {
    // Cleanup on process exit
    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
  }

  private cleanup() {
    console.log('🔄 Cleaning up price monitor connections...');
    this.connections.forEach((ws, symbol) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
    this.connections.clear();
    this.isActive = false;
  }

  // Start monitoring multiple tokens
  async startMonitoring(symbols: string[]): Promise<void> {
    if (this.isActive) {
      console.log('📊 Price monitor already active, adding new symbols...');
    } else {
      console.log('🚀 Starting price monitor...');
      this.isActive = true;
    }

    // Map symbols to Kraken pairs
    const krakenPairs = [];
    const supportedKrakenSymbols = ['ADA', 'BTC', 'ETH', 'SOL', 'MATIC', 'DOT', 'LINK', 'UNI', 'AVAX', 'ATOM', 'XRP'];
    
    for (const symbol of symbols) {
      if (supportedKrakenSymbols.includes(symbol)) {
        krakenPairs.push(`${symbol}/USD`);
      }
    }

    // Connect to Kraken WebSocket for all supported symbols
    if (krakenPairs.length > 0) {
      await this.connectToKraken(krakenPairs);
    }

    // Add Cardano native tokens via TapTools (polling for now)
    const cardanoTokens = symbols.filter(s => 
      !supportedKrakenSymbols.includes(s)
    );

    if (cardanoTokens.length > 0) {
      await this.startCardanoTokenPolling(cardanoTokens);
    }
  }

  // Connect to Kraken WebSocket for ADA
  private async connectToKraken(pairs: string[]): Promise<void> {
    try {
      const ws = new WebSocket('wss://ws.kraken.com');
      
      ws.on('open', () => {
        console.log('🔗 Connected to Kraken WebSocket');
        const subscribeMsg = {
          event: 'subscribe',
          pair: pairs,
          subscription: { name: 'ticker' }
        };
        ws.send(JSON.stringify(subscribeMsg));
      });

      ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data);
          
          // Handle different message types
          if (typeof message === 'object' && message.event) {
            // System messages (subscribed, heartbeat, etc.)
            console.log('Kraken system message:', message.event);
            return;
          }
          
          if (Array.isArray(message) && message.length >= 4) {
            const [channelId, tickerData, channelName, pair] = message;
            
            if (channelName === 'ticker' && tickerData && typeof tickerData === 'object') {
              // Parse ticker data safely
              const priceData: PriceData = {
                symbol: pair.replace('/', '').replace('XBT', 'BTC'), // Handle XBT -> BTC
                price: parseFloat(tickerData.c?.[0] || '0'), // Last price
                change24h: parseFloat(tickerData.p?.[1] || '0'), // 24h change
                changePercent24h: parseFloat(tickerData.P?.[1] || '0'), // 24h change percent
                volume24h: parseFloat(tickerData.v?.[1] || '0'), // 24h volume
                timestamp: Date.now(),
                source: 'kraken'
              };

              if (priceData.price > 0) {
                this.updatePrice(priceData);
              }
            }
          }
        } catch (error) {
          console.error('Error parsing Kraken message:', error);
        }
      });

      ws.on('error', (error) => {
        console.error('Kraken WebSocket error:', error);
      });

      ws.on('close', () => {
        console.log('🔌 Kraken WebSocket disconnected');
        // Implement reconnection logic
        if (this.isActive) {
          setTimeout(() => this.connectToKraken(pairs), 5000);
        }
      });

      this.connections.set('kraken', ws);
    } catch (error) {
      console.error('Failed to connect to Kraken:', error);
    }
  }

  // Removed Binance WebSocket - using Kraken for all major cryptos

  // Start polling for Cardano native tokens
  private async startCardanoTokenPolling(symbols: string[]): Promise<void> {
    const pollInterval = 30000; // 30 seconds for native tokens
    
    const poll = async () => {
      if (!this.isActive) return;

      try {
        // Use TapTools API for Cardano native tokens
        for (const symbol of symbols) {
          await this.fetchCardanoTokenPrice(symbol);
        }
      } catch (error) {
        console.error('Error polling Cardano token prices:', error);
      }

      setTimeout(poll, pollInterval);
    };

    poll();
  }

  // Fetch Cardano token price from TapTools
  private async fetchCardanoTokenPrice(symbol: string): Promise<void> {
    try {
      // This would integrate with existing TapTools API
      const response = await fetch(`https://api.taptools.io/api/v1/token/price?symbol=${symbol}`);
      
      if (response.ok) {
        const data = await response.json();
        const priceData: PriceData = {
          symbol,
          price: data.price || 0,
          change24h: data.change24h || 0,
          changePercent24h: data.changePercent24h || 0,
          volume24h: data.volume24h || 0,
          timestamp: Date.now(),
          source: 'taptools'
        };

        this.updatePrice(priceData);
      }
    } catch (error) {
      console.error(`Error fetching ${symbol} price:`, error);
    }
  }

  // Update price and check alerts
  private updatePrice(priceData: PriceData): void {
    const previousPrice = this.priceCache.get(priceData.symbol)?.price || 0;
    this.priceCache.set(priceData.symbol, priceData);

    // Emit price update event
    this.emit('priceUpdate', priceData, previousPrice);

    // Check alerts for this symbol
    this.checkAlerts(priceData, previousPrice);
  }

  // Check and trigger alerts
  private checkAlerts(priceData: PriceData, previousPrice: number): void {
    const alerts = this.alerts.get(priceData.symbol) || [];
    
    for (const alert of alerts) {
      let shouldTrigger = false;

      switch (alert.type) {
        case 'price_above':
          shouldTrigger = priceData.price > alert.value && previousPrice <= alert.value;
          break;
        case 'price_below':
          shouldTrigger = priceData.price < alert.value && previousPrice >= alert.value;
          break;
        case 'percent_change':
          shouldTrigger = Math.abs(priceData.changePercent24h) > alert.value;
          break;
        case 'volume_spike':
          shouldTrigger = priceData.volume24h > alert.value;
          break;
      }

      if (shouldTrigger) {
        this.emit('alert', {
          ...alert,
          priceData,
          triggeredAt: Date.now()
        });
      }
    }
  }

  // Add alert
  addAlert(symbol: string, alert: Alert): void {
    if (!this.alerts.has(symbol)) {
      this.alerts.set(symbol, []);
    }
    this.alerts.get(symbol)!.push(alert);
    console.log(`📢 Alert added for ${symbol}: ${alert.type} ${alert.value}`);
  }

  // Remove alert
  removeAlert(symbol: string, alertId: string): void {
    const alerts = this.alerts.get(symbol) || [];
    const filteredAlerts = alerts.filter(alert => alert.id !== alertId);
    this.alerts.set(symbol, filteredAlerts);
  }

  // Get current price
  getCurrentPrice(symbol: string): PriceData | null {
    return this.priceCache.get(symbol) || null;
  }

  // Get all monitored symbols
  getMonitoredSymbols(): string[] {
    return Array.from(this.priceCache.keys());
  }

  // Get connection status
  getStatus(): MonitorStatus {
    return {
      isActive: this.isActive,
      connections: Array.from(this.connections.keys()),
      monitoredSymbols: this.getMonitoredSymbols(),
      alertCount: Array.from(this.alerts.values()).flat().length,
      lastUpdate: Math.max(...Array.from(this.priceCache.values()).map(p => p.timestamp))
    };
  }
}

// Types
interface PriceData {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  timestamp: number;
  source: 'kraken' | 'taptools';
}

interface Alert {
  id: string;
  type: 'price_above' | 'price_below' | 'percent_change' | 'volume_spike';
  value: number;
  message?: string;
  enabled: boolean;
  createdAt: number;
}

interface MonitorStatus {
  isActive: boolean;
  connections: string[];
  monitoredSymbols: string[];
  alertCount: number;
  lastUpdate: number;
}

// Global price monitor instance
const priceMonitor = PriceMonitor.getInstance();

// Real-time price monitoring tool
export const realTimePriceMonitorTool = createTool({
  id: 'real-time-price-monitor',
  description: 'Start real-time price monitoring for ADA and major cryptocurrencies using Kraken WebSocket feeds',
  inputSchema: z.object({
    symbols: z.array(z.string()).describe('Array of symbols to monitor (e.g., ["ADA", "BTC", "ETH", "SNEK"]). Major cryptos use Kraken WebSocket, Cardano tokens use TapTools polling.'),
    duration: z.number().optional().default(3600000).describe('Monitoring duration in milliseconds (default: 1 hour)')
  }),
  async execute({ context: { symbols, duration = 3600000 } }) {
    try {
      console.log(`🚀 Starting real-time monitoring for: ${symbols.join(', ')}`);
      
      // Start monitoring
      await priceMonitor.startMonitoring(symbols);
      
      // Set up price update listener
      const priceUpdates: PriceData[] = [];
      const updateListener = (priceData: PriceData) => {
        priceUpdates.push(priceData);
        console.log(`📊 ${priceData.symbol}: $${priceData.price.toFixed(4)} (${priceData.changePercent24h.toFixed(2)}%)`);
      };
      
      priceMonitor.on('priceUpdate', updateListener);
      
      // Stop monitoring after duration
      setTimeout(() => {
        priceMonitor.off('priceUpdate', updateListener);
        console.log('⏰ Monitoring duration completed');
      }, duration);
      
      const status = priceMonitor.getStatus();
      
      return {
        success: true,
        message: `Real-time monitoring started for ${symbols.length} symbols`,
        status,
        symbols,
        duration: duration / 1000 / 60, // Convert to minutes
        instructions: [
          '📊 Price updates will be logged in real-time',
          '🚨 Set up alerts using the price alert tool',
          '⏰ Monitoring will continue for the specified duration',
          '🔄 Use getMonitoringStatus tool to check current status'
        ]
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to start price monitoring',
        suggestions: [
          'Check your internet connection',
          'Verify the symbol names are correct',
          'Try with fewer symbols if experiencing issues'
        ]
      };
    }
  }
});

// Price alert management tool
export const priceAlertTool = createTool({
  id: 'price-alert-tool',
  description: 'Create smart price alerts for support/resistance levels, percentage changes, and volume spikes',
  inputSchema: z.object({
    action: z.enum(['add', 'remove', 'list']).describe('Action to perform'),
    symbol: z.string().optional().describe('Symbol to set alert for'),
    alertType: z.enum(['price_above', 'price_below', 'percent_change', 'volume_spike']).optional().describe('Type of alert'),
    value: z.number().optional().describe('Alert threshold value'),
    message: z.string().optional().describe('Custom alert message'),
    alertId: z.string().optional().describe('Alert ID for removal')
  }),
  async execute({ context: { action, symbol, alertType, value, message, alertId } }) {
    try {
      if (action === 'add') {
        if (!symbol || !alertType || value === undefined) {
          return {
            success: false,
            error: 'Missing required parameters for adding alert',
            required: ['symbol', 'alertType', 'value']
          };
        }

        const alert: Alert = {
          id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: alertType,
          value,
          message: message || `${symbol} ${alertType} ${value}`,
          enabled: true,
          createdAt: Date.now()
        };

        priceMonitor.addAlert(symbol, alert);

        // Set up alert listener
        const alertListener = (triggeredAlert: any) => {
          if (triggeredAlert.id === alert.id) {
            console.log(`🚨 ALERT TRIGGERED: ${triggeredAlert.message}`);
            console.log(`💰 Current price: $${triggeredAlert.priceData.price.toFixed(4)}`);
            console.log(`📈 24h change: ${triggeredAlert.priceData.changePercent24h.toFixed(2)}%`);
          }
        };

        priceMonitor.on('alert', alertListener);

        return {
          success: true,
          message: `Alert created for ${symbol}`,
          alert: {
            id: alert.id,
            symbol,
            type: alertType,
            value,
            message: alert.message
          }
        };
      }

      if (action === 'remove') {
        if (!symbol || !alertId) {
          return {
            success: false,
            error: 'Missing symbol or alertId for removal'
          };
        }

        priceMonitor.removeAlert(symbol, alertId);
        return {
          success: true,
          message: `Alert ${alertId} removed for ${symbol}`
        };
      }

      if (action === 'list') {
        const status = priceMonitor.getStatus();
        return {
          success: true,
          status,
          monitoredSymbols: status.monitoredSymbols,
          totalAlerts: status.alertCount
        };
      }

      return {
        success: false,
        error: 'Invalid action specified'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to manage price alert'
      };
    }
  }
});

// Monitoring status tool
export const monitoringStatusTool = createTool({
  id: 'monitoring-status',
  description: 'Get current status of real-time price monitoring and alerts',
  inputSchema: z.object({
    details: z.boolean().optional().default(false).describe('Include detailed price information')
  }),
  async execute({ context: { details = false } }) {
    try {
      const status = priceMonitor.getStatus();
      
      let response: any = {
        success: true,
        status: status.isActive ? 'active' : 'inactive',
        connections: status.connections,
        monitoredSymbols: status.monitoredSymbols,
        alertCount: status.alertCount,
        lastUpdate: new Date(status.lastUpdate).toISOString()
      };

      if (details) {
        const currentPrices: { [key: string]: PriceData | null } = {};
        for (const symbol of status.monitoredSymbols) {
          currentPrices[symbol] = priceMonitor.getCurrentPrice(symbol);
        }
        response.currentPrices = currentPrices;
      }

      return response;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get monitoring status'
      };
    }
  }
});

// Export the price monitor instance for use in other tools
export { priceMonitor };