# MISTERLABS Discord Bot

A simple Discord bot that connects to TOPDOWN v1 agent on Mastra Cloud. Just mention the bot and chat naturally - the LLM handles all responses.

## Features

- **Natural conversation** - No commands, just mention and chat
- **DM support** - Works in DMs without needing mention
- **Simple design** - Relies entirely on the LLM for responses

## Quick Start

### 1. Install Railway CLI

```bash
npm install -g @railway/cli
```

### 2. Deploy with Railway CLI

```bash
cd discord-bot

# Login to Railway
railway login

# Create new project
railway init

# Set environment variables
railway variables set DISCORD_BOT_TOKEN="your_token_here"
railway variables set MASTRA_BASE_URL="https://modern-purple-ram.mastra.ai"
railway variables set AGENT_ID="topdownV1"

# Deploy
railway up
```

### OR use the deployment script:

```bash
cd discord-bot
./deploy-railway.sh
```

## Environment Variables

- `DISCORD_BOT_TOKEN` - Your Discord bot token
- `MASTRA_BASE_URL` - Your Mastra Cloud URL 
- `AGENT_ID` - The agent ID (default: topdownV1)

## Usage

1. **Mention the bot**: `@bot how's the weather?`
2. **DM the bot**: Send direct messages without mention
3. **Natural conversation**: The bot responds using the TOPDOWN v1 agent

## Railway CLI Commands

```bash
# View logs
railway logs

# Open dashboard
railway open

# Redeploy
railway up

# Check status
railway status
```

## Local Testing

```bash
npm install
npm start
```

## Notes

- The bot only responds when mentioned or in DMs
- All responses come directly from the TOPDOWN v1 agent
- No commands or special syntax needed