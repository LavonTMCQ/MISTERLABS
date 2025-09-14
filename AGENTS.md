# Repository Guidelines

## Project Structure & Module Organization
- `src/mastra/agents/`: conversational agents (`sql-agent.ts`, `topdown-v1.ts`, `delilah.ts`, `mister.ts`).
- `src/mastra/tools/`: reusable tools (DB introspection, seeding, SQL generation/execution, orchestrator utilities).
- `src/mastra/workflows/`: orchestrated workflows (e.g., `database-query-workflow.ts`).
- `src/mastra/index.ts`: Mastra instance wiring (agents, workflows, storage, logger).
- `discord-bot/`: standalone Node service to bridge Discord to agents.
- `.env.example`: root app env; `discord-bot/.env.example`: bot env.

## Build, Test, and Development Commands
- Root (Node >= 20.9):
  - `pnpm install` — install deps.
  - `pnpm dev` — run Mastra locally (`mastra dev`).
  - `pnpm build` — build Mastra project (`mastra build`).
  - `pnpm start` — start built app (`mastra start`).
- Discord bot:
  - `cd discord-bot && npm install && npm start` — run the bot.

## Coding Style & Naming Conventions
- Language: TypeScript (strict, ES modules). Indent 2 spaces.
- Filenames: `kebab-case.ts` (e.g., `sql-execution-tool.ts`).
- Symbols: `camelCase` for vars/functions, `PascalCase` for classes/types.
- Schemas/IO: prefer `zod`; avoid `any`; type tool inputs/outputs.
- Tools: export via `createTool` and use stable, `kebab-case` `id` values.

## Testing Guidelines
- No formal test runner configured. For changes, provide manual validation steps in PRs (commands, expected logs, sample inputs/outputs).
- If adding tests, use `*.test.ts` colocated with code and wire a runner (Vitest/Jest). Keep DB tests against a disposable Postgres or a dedicated test `DATABASE_URL`.

## Commit & Pull Request Guidelines
- Commits: imperative mood, concise subject (≈72 chars). Common prefixes: Add/Update/Fix/Refactor/Configure.
- PRs must include:
  - Summary + motivation; linked issues.
  - Validation steps (e.g., `pnpm dev`, sample agent prompt → result, DB query run).
  - Notable risks and roll‑out notes.
  - Env var changes (`.env.example` updated when applicable).
  - For agent/tool changes: before/after example messages or SQL, and safety notes (SELECT‑only enforcement).

## Security & Configuration
- Root `.env`: `OPENAI_API_KEY` (required), `DATABASE_URL` (for Postgres), optional `OPENROUTER_API_KEY` (for MISTER).
- Discord bot `.env`: `DISCORD_BOT_TOKEN`, `MASTRA_BASE_URL`, `AGENT_ID`.
- Do not commit secrets. Keep SQL execution SELECT‑only (enforced in `sql-execution-tool`).
