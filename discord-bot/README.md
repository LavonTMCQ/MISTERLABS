# MISTERLABS Discord Bot - TOPDOWN v1 Interface

Discord bot that connects to the TOPDOWN v1 orchestrator agent hosted on Mastra Cloud.

## Features

- **Direct Integration**: Connects to Mastra Cloud hosted TOPDOWN v1 agent
- **Cold Personality**: Maintains TOPDOWN v1's direct, technical communication style
- **Conversation Memory**: Tracks conversation history per channel
- **Error Handling**: Robust error handling with TOPDOWN-style error messages

## Commands

- `!topdown [query]` - Send a query to TOPDOWN v1
- `!topdown status` - Check system status
- `!topdown clear` - Clear conversation memory for current channel
- `!topdown help` - Show available commands
- `@bot [query]` - Mention the bot directly to interact

## Deployment on Railway

### Prerequisites

1. Discord Bot Token from [Discord Developer Portal](https://discord.com/developers/applications)
2. Mastra Cloud deployment URL (e.g., `https://modern-purple-ram.mastra.ai`)
3. Railway account

### Deploy to Railway

1. **Fork/Clone this repository**

2. **Connect to Railway**:
   - Go to [Railway](https://railway.app)
   - Create new project
   - Connect GitHub repository

3. **Set Environment Variables**:
   ```
   DISCORD_BOT_TOKEN=your_discord_bot_token
   MASTRA_BASE_URL=https://your-project.mastra.ai
   AGENT_ID=topdownV1
   ```

4. **Deploy**:
   - Railway will automatically detect Node.js project
   - Bot will start and connect to Discord

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env` file:
   ```env
   DISCORD_BOT_TOKEN=your_token_here
   MASTRA_BASE_URL=https://modern-purple-ram.mastra.ai
   AGENT_ID=topdownV1
   ```

3. Run the bot:
   ```bash
   npm start
   ```

## Architecture

```
Discord User → Discord Bot → Mastra Cloud API → TOPDOWN v1 Agent
                    ↓
              Railway Hosting
```

## Mastra Cloud Endpoints

The bot connects to these Mastra Cloud endpoints:

- `POST /api/agents/{agentId}/generate` - Generate response
- `POST /api/agents/{agentId}/stream` - Stream response (future implementation)
- `GET /api/agents/{agentId}` - Get agent info
- `GET /api/agents/{agentId}/evals/c1` - Evaluation endpoint
- `GET /api/agents/{agentId}/evals/live` - Live evaluation

## TOPDOWN v1 Capabilities

When connected, the bot provides access to:

- Database introspection and queries
- SQL generation from natural language
- System status monitoring
- Agent delegation for complex tasks
- Memory persistence across conversations

## Error Responses

TOPDOWN v1 style error responses:
- `FAILURE: AGENT_NOT_FOUND` - Agent not found on Mastra Cloud
- `FAILURE: AUTHENTICATION_ERROR` - Invalid credentials
- `FAILURE: TIMEOUT` - Request timeout
- `FAILURE: CONNECTION_ERROR` - Network error

## Support

Repository: https://github.com/LavonTMCQ/MISTERLABS