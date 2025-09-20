import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Hyperliquid } from "@hyper-d3x/hyperliquid-ts-sdk";
import { ethers } from "ethers";

// Initialize Hyperliquid SDK instance
const getHyperliquidSDK = () => {
  if (!process.env.HYPERLIQUID_PRIVATE_KEY) {
    throw new Error("HYPERLIQUID_PRIVATE_KEY environment variable is required");
  }
  
  const wallet = new ethers.Wallet(process.env.HYPERLIQUID_PRIVATE_KEY);
  return new Hyperliquid(wallet);
};

// Get all available markets and their mid prices
export const getHyperliquidMarkets = createTool({
  id: "Get Hyperliquid Markets",
  description: "Fetch all available markets and their current mid prices from Hyperliquid",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const sdk = getHyperliquidSDK();
      const markets = await sdk.info.getAllMids();
      return {
        success: true,
        markets,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        timestamp: Date.now(),
      };
    }
  },
});

// Get account information
export const getHyperliquidAccount = createTool({
  id: "Get Hyperliquid Account",
  description: "Get account information including open orders from Hyperliquid",
  inputSchema: z.object({
    address: z.string().optional().describe("Wallet address (optional, uses connected wallet if not provided)"),
  }),
  execute: async ({ context: { address } }) => {
    try {
      const sdk = getHyperliquidSDK();
      const wallet = new ethers.Wallet(process.env.HYPERLIQUID_PRIVATE_KEY!);
      const addressToUse = address || wallet.address;

      const openOrders = await sdk.info.getUserOpenOrders(addressToUse);

      return {
        success: true,
        address: addressToUse,
        openOrders,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        timestamp: Date.now(),
      };
    }
  },
});

// Get market data for specific asset
export const getHyperliquidMarketData = createTool({
  id: "Get Hyperliquid Market Data",
  description: "Get detailed market data for a specific asset including orderbook",
  inputSchema: z.object({
    coin: z.string().describe("The coin symbol (e.g., 'BTC', 'ETH')"),
  }),
  execute: async ({ context: { coin } }) => {
    try {
      const sdk = getHyperliquidSDK();

      const orderbook = await sdk.info.getL2Book(coin);

      return {
        success: true,
        coin,
        orderbook,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        coin,
        timestamp: Date.now(),
      };
    }
  },
});

// Place an order on Hyperliquid
export const placeHyperliquidOrder = createTool({
  id: "Place Hyperliquid Order",
  description: "Place a trading order on Hyperliquid DEX",
  inputSchema: z.object({
    coin: z.string().describe("The coin to trade (e.g., 'BTC', 'ETH')"),
    is_buy: z.boolean().describe("True for buy/long, false for sell/short"),
    sz: z.number().positive().describe("Size of the order"),
    limit_px: z.number().positive().describe("Limit price for the order"),
    reduce_only: z.boolean().default(false).describe("Whether this is a reduce-only order"),
  }),
  execute: async ({ context: { coin, is_buy, sz, limit_px, reduce_only } }) => {
    try {
      const sdk = getHyperliquidSDK();

      const orderRequest = {
        coin,
        is_buy,
        sz,
        limit_px,
        order_type: { limit: { tif: "Ioc" as any } },
        reduce_only,
      };

      const result = await sdk.exchange.placeOrder(orderRequest);

      return {
        success: true,
        order: orderRequest,
        result,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        order: { coin, is_buy, sz, limit_px, reduce_only },
        timestamp: Date.now(),
      };
    }
  },
});

// Cancel orders
export const cancelHyperliquidOrder = createTool({
  id: "Cancel Hyperliquid Order",
  description: "Cancel existing orders on Hyperliquid",
  inputSchema: z.object({
    cancels: z.array(z.object({
      coin: z.string(),
      oid: z.number(),
    })).describe("Array of orders to cancel"),
  }),
  execute: async ({ context: { cancels } }) => {
    try {
      const sdk = getHyperliquidSDK();
      const result = await sdk.exchange.cancelOrder(cancels);

      return {
        success: true,
        cancelRequests: cancels,
        result,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        cancelRequests: cancels,
        timestamp: Date.now(),
      };
    }
  },
});

// Get order status
export const getHyperliquidOrderStatus = createTool({
  id: "Get Hyperliquid Order Status",
  description: "Get the status of open orders for the account",
  inputSchema: z.object({
    address: z.string().optional().describe("Wallet address (optional)"),
  }),
  execute: async ({ context: { address } }) => {
    try {
      const sdk = getHyperliquidSDK();
      const wallet = new ethers.Wallet(process.env.HYPERLIQUID_PRIVATE_KEY!);
      const addressToUse = address || wallet.address;

      const openOrders = await sdk.info.getUserOpenOrders(addressToUse);

      return {
        success: true,
        address: addressToUse,
        openOrders,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        address,
        timestamp: Date.now(),
      };
    }
  },
});

// Execute a validated trading plan (dry run simulation)
export const executeHyperliquidPlan = createTool({
  id: "Execute Hyperliquid Trading Plan",
  description: "Execute a complete trading plan on Hyperliquid (dry run simulation)",
  inputSchema: z.object({
    planJson: z.string().describe("JSON string of the validated trading plan"),
    dryRun: z.boolean().default(true).describe("Whether to simulate the execution"),
  }),
  execute: async ({ context: { planJson, dryRun } }) => {
    try {
      const plan = JSON.parse(planJson);
      const results: any[] = [];

      // For safety, this tool only does dry runs by default
      const isDryRun = dryRun !== false;

      // Get current market prices for calculations
      const sdk = getHyperliquidSDK();
      const markets = await sdk.info.getAllMids();
      
      // Simulate execution for all positions
      [...(plan.positions_to_modify || []), ...(plan.positions_to_open || [])].forEach(position => {
        const price = markets[position.market.toUpperCase()];
        results.push({
          action: plan.positions_to_modify?.includes(position) ? "modify" : "open",
          market: position.market,
          direction: position.direction,
          size: position.size,
          success: true,
          dryRun: isDryRun,
          estimatedPrice: price,
        });
      });

      return {
        success: true,
        dryRun: isDryRun,
        totalOrders: results.length,
        results,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        timestamp: Date.now(),
      };
    }
  },
});

// Get basic market information
export const getHyperliquidFundingInfo = createTool({
  id: "Get Hyperliquid Market Info",
  description: "Get basic market information from Hyperliquid",
  inputSchema: z.object({
    coin: z.string().optional().describe("Specific coin to get info for (optional)"),
  }),
  execute: async ({ context: { coin } }) => {
    try {
      const sdk = getHyperliquidSDK();
      const markets = await sdk.info.getAllMids();

      if (coin) {
        const coinPrice = markets[coin.toUpperCase()];
        return {
          success: true,
          coin,
          price: coinPrice,
          timestamp: Date.now(),
        };
      }

      return {
        success: true,
        allMarkets: markets,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        timestamp: Date.now(),
      };
    }
  },
});