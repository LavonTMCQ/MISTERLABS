import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const BASE_URL = "https://api.sandbox.competitions.recall.network/api";

const getHeaders = () => ({
    accept: "application/json",
    Authorization: `Bearer ${process.env.RECALL_API_KEY}`,
});

export const getRecallAgent = createTool({
    id: "Get Recall Agent",
    inputSchema: z.object({}),
    description: "Get information about a Recall agent by agentId.",
    execute: async ({ }) => {
        const url = `${BASE_URL}/agent/profile`;

        const response = await fetch(url, { method: "GET", headers: getHeaders() });
        if (!response.ok) {
            throw new Error(
                `Recall API error: ${response.status} ${response.statusText}`
            );
        }
        return await response.json();
    },
});

export const getRecallAgentPortfolio = createTool({
    id: "Get Recall Agent Portfolio",
    inputSchema: z.object({}),
    description: "Get the portfolio of a Recall agent.",
    execute: async ({ }) => {
        const url = `${BASE_URL}/agent/portfolio`;
        const response = await fetch(url, { method: "GET", headers: getHeaders() });
        if (!response.ok) {
            throw new Error(
                `Recall API error: ${response.status} ${response.statusText}`
            );
        }
        return await response.json();
    },
});

export const getRecallAgentBalances = createTool({
    id: "Get Recall Agent Balances",
    inputSchema: z.object({}),
    description: "Get the balances of a Recall agent.",
    execute: async ({ }) => {
        const url = `${BASE_URL}/agent/balances`;
        const response = await fetch(url, { method: "GET", headers: getHeaders() });
        if (!response.ok) {
            throw new Error(
                `Recall API error: ${response.status} ${response.statusText}`
            );
        }
        return await response.json();
    },
});

export const getRecallAgentTrades = createTool({
    id: "Get Recall Agent Trades",
    inputSchema: z.object({}),
    description: "Get the trades of a Recall agent",
    execute: async ({ }) => {
        const url = `${BASE_URL}/agent/trades`;
        const response = await fetch(url, { method: "GET", headers: getHeaders() });
        if (!response.ok) {
            throw new Error(
                `Recall API error: ${response.status} ${response.statusText}`
            );
        }
        return await response.json();
    },
});

export const getRecallTradeQuote = createTool({
    id: "Get Recall Trade Quote",
    inputSchema: z.object({
        fromToken: z.string(),
        toToken: z.string(),
        amount: z.string(),
        fromChain: z.string().optional(),
        fromSpecificChain: z.string().optional(),
        toChain: z.string().optional(),
        toSpecificChain: z.string().optional(),
    }),
    description:
        "Get a quote for a potential trade between two tokens using Recall trading API.",
    execute: async ({ context }) => {
        const params = new URLSearchParams({
            fromToken: context.fromToken,
            toToken: context.toToken,
            amount: context.amount,
            ...(context.fromChain ? { fromChain: context.fromChain } : {}),
            ...(context.fromSpecificChain
                ? { fromSpecificChain: context.fromSpecificChain }
                : {}),
            ...(context.toChain ? { toChain: context.toChain } : {}),
            ...(context.toSpecificChain
                ? { toSpecificChain: context.toSpecificChain }
                : {}),
        });
        const url = `${BASE_URL}/trade/quote?${params.toString()}`;
        const response = await fetch(url, { method: "GET", headers: getHeaders() });
        if (!response.ok) {
            throw new Error(
                `Recall Trade Quote API error: ${response.status} ${response.statusText}`
            );
        }
        return await response.json();
    },
});

export const executeRecallTrade = createTool({
    id: "Execute Recall Trade",
    inputSchema: z.object({
        fromToken: z.string(),
        toToken: z.string(),
        amount: z.string(),
        reason: z.string(),
        slippageTolerance: z.string().optional(),
        fromChain: z.string().optional(),
        fromSpecificChain: z.string().optional(),
        toChain: z.string().optional(),
        toSpecificChain: z.string().optional(),
    }),
    description:
        "Execute a trade between two tokens using Recall trading API. Requires a reason for the trade.",
    execute: async ({ context }) => {
        const url = `${BASE_URL}/trade/execute`;
        const body = {
            fromToken: context.fromToken,
            toToken: context.toToken,
            amount: context.amount,
            reason: context.reason,
            ...(context.slippageTolerance
                ? { slippageTolerance: context.slippageTolerance }
                : {}),
            ...(context.fromChain ? { fromChain: context.fromChain } : {}),
            ...(context.fromSpecificChain
                ? { fromSpecificChain: context.fromSpecificChain }
                : {}),
            ...(context.toChain ? { toChain: context.toChain } : {}),
            ...(context.toSpecificChain
                ? { toSpecificChain: context.toSpecificChain }
                : {}),
        };
        const response = await fetch(url, {
            method: "POST",
            headers: { ...getHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(
                `Recall Execute Trade API error: ${response.status} ${response.statusText}`
            );
        }
        return await response.json();
    },
});