import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { openai } from "@ai-sdk/openai"; // or google/openai model providers
// import { openai } from '@ai-sdk/openai';
// import { google } from '@ai-sdk/google';

/**
 * Hackathon Agent Template
 * ---------------------------------
 * HOW TO USE
 * 1. Duplicate this file and rename it to something meaningful (e.g. research_agent.ts)
 * 2. Replace TEMPLATE_ placeholders below.
 * 3. Add / remove tools in the tools object as needed.
 * 4. Import and register the agent in src/mastra/index.ts under the agents map.
 * 5. (Optional) Add workflows that orchestrate multiple agents.
 * 
 * APPLIED EXAMPLES IN THIS PROJECT:
 * - recall_trading_agent.ts: CEX trading specialist (uses recall_tool + market data)
 * - hyperliquid_trading_agent.ts: DEX trading specialist (uses hyperliquid-tool + market data)
 * - weather-agent.ts: Weather information specialist (uses weather-tool)
 * 
 * DESIGN GUIDELINES
 * - Keep instructions concise and strongly directive.
 * - Describe required output format (JSON) if you need structured data.
 * - List available tools and when to use each (reduces hallucinations & unnecessary calls).
 * - Include guardrails: what NOT to do.
 * - Keep memory storage consistent if you want cross‑session recall.
 * - Focus on a single domain/platform for clarity (avoid mixing concerns)
 */

// Example placeholder tool imports (add your own tools under src/mastra/tools)
// import { exampleTool } from "../tools/example-tool";

export const createTemplateAgent = () => {
  return new Agent({
    name: "TEMPLATE_AGENT_NAME", // e.g. "Research Agent"
    instructions: `
# ROLE
You are TEMPLATE_AGENT_ROLE (e.g. an on‑chain research assistant) that helps users TEMPLATE_AGENT_VALUE_PROP.

# CAPABILITIES
- Summarize: ...
- Analyze: ...
- Compare: ...
- (Add capabilities tailored to your use case.)

# INPUT CONTEXT
You will receive user queries possibly containing: goals, constraints, assets, time horizon.
Always ask *one* clarifying question if critical info is missing.

# OUTPUT FORMAT
Return concise helpful prose unless a structured format is explicitly requested.
If the user requests structured output, respond with ONLY JSON matching the schema they provide.

# TOOL USAGE POLICY
- Only call a tool when its data is required to progress the user objective.
- Do not call the same tool repeatedly without new user intent or a changed parameter.
- If a tool fails, gracefully explain and suggest next steps.

# STYLE
- Factual, neutral, actionable.
- Avoid hype, disclaimers beyond a single short risk note if finance related.

# SAFETY & GUARDRAILS
- Never fabricate metrics or prices. Always fetch before citing numbers.
- If unsure, state uncertainty and propose how to validate.

# WHEN TO SAY NO
- Decline requests involving irreversible financial actions without confirmation.
- Decline unrelated or disallowed content.

Respond now acknowledging readiness if directly addressed, else wait for a user question.
`,
    model: openai("gpt-4o-mini"), // swap model here
    tools: {
      // exampleTool,
    },
    memory: new Memory({
      storage: new LibSQLStore({
        url: "file:../mastra.db", // persistent light weight sqlite (relative to .mastra/output)
      }),
    }),
  });
};

// Optional: immediately export an instance (uncomment if you prefer singleton usage)
// export const templateAgent = createTemplateAgent();