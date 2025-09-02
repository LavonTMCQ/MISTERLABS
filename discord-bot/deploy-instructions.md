# Deploy Discord Bot to Railway

## Quick Deploy Steps

Open your terminal and run these commands:

```bash
# 1. Navigate to discord-bot directory
cd /Users/coldgame/MISTERLABS/discord-bot

# 2. Login to Railway (will open browser)
railway login

# 3. Create new project
railway init

# 4. Link to GitHub repo (optional but recommended)
railway link

# 5. Set your environment variables
railway variables set DISCORD_BOT_TOKEN="your_discord_bot_token_here"
railway variables set MASTRA_BASE_URL="https://modern-purple-ram.mastra.ai"
railway variables set AGENT_ID="topdownV1"

# 6. Deploy
railway up

# 7. Check logs
railway logs
```

## What happens:

1. `railway login` - Opens browser to authenticate
2. `railway init` - Creates a new Railway project
3. `railway link` - Links to your GitHub repo (optional)
4. `railway variables set` - Sets environment variables
5. `railway up` - Deploys your bot
6. `railway logs` - Shows bot output

## After deployment:

- View dashboard: `railway open`
- Check status: `railway status`
- Redeploy: `railway up`
- View logs: `railway logs`

Your bot will be running 24/7 on Railway!