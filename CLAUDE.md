# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## IMPORTANT: Mastra MCP Server

**ALWAYS use the Mastra MCP server** (`mcp__mastra-docs__*` tools) to ensure code is up-to-date with the latest Mastra framework patterns and best practices. The MCP server provides:
- Current Mastra documentation
- Latest API references
- Working code examples
- Framework updates and changes

Before implementing Mastra features, consult the MCP server documentation to verify current syntax and patterns.

## Project Overview

MISTERLABS is a Mastra-based workflow system for database introspection and natural language to SQL conversion with PostgreSQL databases.

## Development Commands

```bash
# Install dependencies
pnpm install

# Development mode with hot reload
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start
```

## Architecture

### Core Components

The system is built using Mastra framework with the following architecture:

1. **Mastra Instance** (`src/mastra/index.ts`):
   - Configures agents and workflows
   - Uses LibSQLStore for telemetry storage
   - Implements PinoLogger for logging

2. **SQL Agent** (`src/mastra/agents/sql-agent.ts`):
   - Comprehensive database assistant with memory persistence
   - Handles complete workflow: connection → seeding → introspection → querying → execution
   - Uses AI (OpenAI GPT-4) for natural language processing

3. **Database Query Workflow** (`src/mastra/workflows/database-query-workflow.ts`):
   - Multi-step interactive workflow with suspend/resume capabilities
   - Steps: connection → optional seeding → introspection → SQL generation → review & execution

### Tools

All tools are in `src/mastra/tools/`:
- `database-introspection-tool.ts`: Analyzes PostgreSQL schemas
- `database-seeding-tool.ts`: Seeds comprehensive business datasets
- `sql-generation-tool.ts`: Converts natural language to SQL using OpenAI
- `sql-execution-tool.ts`: Safely executes SELECT queries only

## Key Patterns

### Tool Structure
All tools follow this pattern:
```typescript
export const toolName = createTool({
  id: 'tool-id',
  name: 'Tool Name',
  description: '...',
  inputSchema: z.object({...}),
  outputSchema: z.object({...}),
  execute: async (inputs) => {...}
});
```

### Workflow Steps
Steps use suspend/resume for user interaction:
```typescript
const step = createStep({
  id: 'step-id',
  inputSchema: z.object({...}),
  outputSchema: z.object({...}),
  resumeSchema: z.object({...}),
  suspendSchema: z.object({...}),
  execute: async ({ input, resumeData, suspend }) => {...}
});
```

## Environment Configuration

Required environment variables in `.env`:
```env
OPENAI_API_KEY=your-openai-api-key
```

## TypeScript Configuration

- Target: ES2022
- Module: ES2022
- Strict mode enabled
- No emit (Mastra handles compilation)

## Security Constraints

- Only SELECT queries allowed in SQL execution tool
- Connection pooling implemented for efficiency
- All operations logged for audit trails
- No DML/DDL operations permitted

## Dependencies

Core dependencies:
- `@mastra/core`: Workflow orchestration
- `@ai-sdk/openai`: AI integration
- `pg`: PostgreSQL client
- `zod`: Runtime validation

## Development Tips

1. Use `mastra dev` for hot-reload development
2. The system uses ES modules (`"type": "module"` in package.json)
3. Node.js 20.9.0+ required
4. Mastra CLI handles build and deployment