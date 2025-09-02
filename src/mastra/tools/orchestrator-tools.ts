import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Delegate complex SQL operations to specialized SQL Agent
 */
export const delegateToSQLAgent = createTool({
  id: 'delegate-sql-agent',
  description: 'Delegate complex database operations to specialized SQL Agent for multi-step workflows',
  inputSchema: z.object({
    query: z.string().describe('Natural language query or SQL operation request'),
    context: z.object({
      connectionString: z.string().optional().describe('Database connection if not already established'),
      requiresSeeding: z.boolean().optional().describe('Whether to seed database with sample data'),
      maxSteps: z.number().optional().default(5).describe('Maximum workflow steps allowed'),
    }).optional(),
  }),
  outputSchema: z.object({
    status: z.enum(['SUCCESS', 'FAILURE', 'DELEGATED']),
    result: z.any().optional(),
    agentUsed: z.string(),
    executionTime: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ context, mastra }) => {
    const startTime = Date.now();
    
    try {
      const sqlAgent = mastra?.getAgent('sqlAgent');
      
      if (!sqlAgent) {
        return {
          status: 'FAILURE' as const,
          agentUsed: 'sqlAgent',
          executionTime: Date.now() - startTime,
          error: 'SQL_AGENT_UNAVAILABLE',
        };
      }

      const response = await sqlAgent.generate(
        [{ role: 'user', content: context.query }],
        { 
          maxSteps: context.context?.maxSteps || 5,
        }
      );

      return {
        status: 'SUCCESS' as const,
        result: response.text,
        agentUsed: 'sqlAgent',
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        status: 'FAILURE' as const,
        agentUsed: 'sqlAgent',
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      };
    }
  },
});

/**
 * System status and capability check
 */
export const systemStatus = createTool({
  id: 'system-status',
  description: 'Check MISTERLABS system status, available agents, and operational metrics',
  inputSchema: z.object({
    checkType: z.enum(['full', 'agents', 'tools', 'memory', 'performance']).default('full'),
  }),
  outputSchema: z.object({
    status: z.enum(['OPERATIONAL', 'DEGRADED', 'FAILURE']),
    agents: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    memory: z.object({
      active: z.boolean(),
      records: z.number(),
    }).optional(),
    metrics: z.object({
      uptime: z.number(),
      requestsProcessed: z.number(),
      averageResponseTime: z.number(),
    }).optional(),
  }),
  execute: async ({ context, mastra }) => {
    const result: any = {
      status: 'OPERATIONAL' as const,
    };

    if (context.checkType === 'agents' || context.checkType === 'full') {
      // Check available agents
      const agents: string[] = [];
      try {
        if (mastra?.getAgent('sqlAgent')) agents.push('sqlAgent');
        if (mastra?.getAgent('topdownV1')) agents.push('topdownV1');
      } catch {}
      result.agents = agents;
    }

    if (context.checkType === 'tools' || context.checkType === 'full') {
      // List available tools
      result.tools = [
        'database-introspection',
        'database-seeding',
        'sql-generation',
        'sql-execution',
        'delegate-sql-agent',
        'system-status',
        'announce-capability',
      ];
    }

    if (context.checkType === 'memory' || context.checkType === 'full') {
      // Memory status (simulated for now)
      result.memory = {
        active: true,
        records: 0, // Would query actual memory store
      };
    }

    if (context.checkType === 'performance' || context.checkType === 'full') {
      // Performance metrics (simulated for now)
      result.metrics = {
        uptime: Date.now() - (global as any).startTime || 0,
        requestsProcessed: 0, // Would track actual requests
        averageResponseTime: 0, // Would calculate actual average
      };
    }

    return result;
  },
});

/**
 * Announce system capabilities
 */
export const announceCapability = createTool({
  id: 'announce-capability',
  description: 'Announce specific MISTERLABS system capability or feature availability',
  inputSchema: z.object({
    capability: z.enum([
      'DATABASE_OPERATIONS',
      'SQL_GENERATION',
      'AGENT_ORCHESTRATION',
      'MEMORY_PERSISTENCE',
      'WORKFLOW_EXECUTION',
      'MULTI_TOOL_COORDINATION',
    ]),
    details: z.boolean().optional().default(false),
  }),
  outputSchema: z.object({
    capability: z.string(),
    available: z.boolean(),
    description: z.string().optional(),
    requirements: z.array(z.string()).optional(),
  }),
  execute: async ({ context }) => {
    const capabilities: Record<string, any> = {
      DATABASE_OPERATIONS: {
        available: true,
        description: 'PostgreSQL interface. Schema analysis. Query execution.',
        requirements: ['Connection string'],
      },
      SQL_GENERATION: {
        available: true,
        description: 'Natural language to SQL. GPT-4 powered.',
        requirements: ['OpenAI API key'],
      },
      AGENT_ORCHESTRATION: {
        available: true,
        description: 'Multi-agent coordination. Task delegation.',
        requirements: [],
      },
      MEMORY_PERSISTENCE: {
        available: true,
        description: 'Cross-session context. Semantic recall.',
        requirements: ['LibSQL storage'],
      },
      WORKFLOW_EXECUTION: {
        available: true,
        description: 'Multi-step workflows. Suspend/resume support.',
        requirements: [],
      },
      MULTI_TOOL_COORDINATION: {
        available: true,
        description: 'Concurrent tool execution. Result aggregation.',
        requirements: [],
      },
    };

    const cap = capabilities[context.capability];
    
    return {
      capability: context.capability,
      available: cap?.available || false,
      ...(context.details && cap ? {
        description: cap.description,
        requirements: cap.requirements,
      } : {}),
    };
  },
});