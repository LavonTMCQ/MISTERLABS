# MISTERLABS TOPDOWN v1 - Deployment Guide

## Repository
https://github.com/LavonTMCQ/MISTERLABS

## Cloud Deployment Options

### 1. Vercel Deployment (Recommended for Discord Bot)

1. Fork or clone the repository
2. Connect to Vercel: https://vercel.com/new
3. Import the GitHub repository
4. Set environment variables:
   - `OPENAI_API_KEY`: Your OpenAI API key
5. Deploy

### 2. Railway Deployment

1. Connect GitHub repository to Railway
2. Add environment variable: `OPENAI_API_KEY`
3. Deploy with automatic builds

### 3. Render Deployment

1. Create new Web Service on Render
2. Connect GitHub repository
3. Build Command: `pnpm install && pnpm build`
4. Start Command: `pnpm start`
5. Add environment variable: `OPENAI_API_KEY`

## Discord Bot Integration Endpoints

Once deployed, your TOPDOWN v1 agent will be accessible at:

### Primary Endpoints

- **Generate Response**: `POST [YOUR_DOMAIN]/api/agents/topdownV1/generate`
- **Stream Response**: `POST [YOUR_DOMAIN]/api/agents/topdownV1/stream`

### Request Format

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Your message here"
    }
  ],
  "maxSteps": 5
}
```

### Discord Bot Integration Example

```javascript
// Discord.js bot integration
const axios = require('axios');

// Your deployed Mastra endpoint
const MASTRA_ENDPOINT = 'https://your-app.vercel.app/api/agents/topdownV1/generate';

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  try {
    const response = await axios.post(MASTRA_ENDPOINT, {
      messages: [
        {
          role: 'user',
          content: message.content
        }
      ],
      maxSteps: 5
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    // TOPDOWN v1's cold, direct response
    await message.reply(response.data.text);
  } catch (error) {
    await message.reply('FAILURE: Connection error.');
  }
});
```

## TOPDOWN v1 Capabilities

- **Database Operations**: Connect to PostgreSQL databases and execute queries
- **SQL Generation**: Convert natural language to SQL
- **System Status**: Check operational status and available tools
- **Memory Persistence**: Maintains context across conversations
- **Agent Delegation**: Delegates complex tasks to specialized SQL Agent

## Environment Variables

Required:
- `OPENAI_API_KEY`: Your OpenAI API key

Optional (for database operations):
- `DATABASE_URL`: PostgreSQL connection string

## Testing the Deployment

Test your deployment with curl:

```bash
curl -X POST https://your-app.vercel.app/api/agents/topdownV1/generate \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "System status"}
    ]
  }'
```

Expected response from TOPDOWN v1:
```json
{
  "text": "OPERATIONAL.",
  "usage": {...}
}
```

## Support

Repository: https://github.com/LavonTMCQ/MISTERLABS