import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Delegates a natural language price/market question to the registered price agent
export const delegateToPriceAgent = createTool({
  id: 'delegate-price-agent',
  description: 'Delegate price or market data questions to the Enhanced Price & Market Data Agent',
  inputSchema: z.object({
    prompt: z.string().describe('User question about price, OHLCV, indicators, or market data'),
    maxSteps: z.number().optional().default(10).describe('Maximum steps the agent should take'),
  }),
  outputSchema: z.object({
    status: z.enum(['SUCCESS', 'FAILURE', 'DELEGATED']),
    agentUsed: z.string(),
    result: z.any().optional(),
    executionTime: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ context, mastra }) => {
    const start = Date.now();
    try {
      const agent = mastra?.getAgent('price-agent');
      if (!agent) {
        return {
          status: 'FAILURE' as const,
          agentUsed: 'price-agent',
          executionTime: Date.now() - start,
          error: 'PRICE_AGENT_UNAVAILABLE',
        };
      }

      const response = await agent.generate([
        { role: 'user', content: context.prompt },
      ], { maxSteps: context.maxSteps ?? 10 });

      return {
        status: 'SUCCESS' as const,
        agentUsed: 'price-agent',
        executionTime: Date.now() - start,
        result: response.text,
      };
    } catch (error) {
      return {
        status: 'FAILURE' as const,
        agentUsed: 'price-agent',
        executionTime: Date.now() - start,
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      };
    }
  },
});
