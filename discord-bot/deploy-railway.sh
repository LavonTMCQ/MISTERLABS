#!/bin/bash

# Railway CLI Deployment Script for Discord Bot

echo "🚂 Railway Deployment for MISTERLABS Discord Bot"
echo "================================================"

# Check if railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Installing..."
    echo "Run: npm install -g @railway/cli"
    exit 1
fi

# Login to Railway
echo "📝 Logging into Railway..."
railway login

# Initialize Railway project
echo "🎯 Initializing Railway project..."
railway init

# Link to existing project (optional)
# railway link

# Set environment variables
echo "🔐 Setting environment variables..."
railway variables set DISCORD_BOT_TOKEN="$DISCORD_BOT_TOKEN"
railway variables set MASTRA_BASE_URL="https://modern-purple-ram.mastra.ai"
railway variables set AGENT_ID="mister"

# Deploy
echo "🚀 Deploying to Railway..."
railway up

echo "✅ Deployment complete!"
echo ""
echo "View logs with: railway logs"
echo "Open dashboard: railway open"
