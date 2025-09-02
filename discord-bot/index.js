require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const axios = require('axios');

// Bot configuration
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const MASTRA_BASE_URL = process.env.MASTRA_BASE_URL || 'https://cloud.mastra.ai';
const AGENT_ID = process.env.AGENT_ID || 'topdownV1';

// Create Discord client with minimal intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Bot ready
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`📡 Connected to: ${MASTRA_BASE_URL}`);
});

// Message handler
client.on(Events.MessageCreate, async (message) => {
  // Ignore other bots
  if (message.author.bot) return;
  
  // Only respond when mentioned
  const mentioned = message.mentions.has(client.user);
  
  if (!mentioned) return;
  
  // Clean message (remove mention)
  let content = message.content;
  if (mentioned) {
    content = content.replace(/<@!?\d+>/g, '').trim();
  }
  
  if (!content) return;
  
  // Show typing
  await message.channel.sendTyping();
  
  try {
    // Call Mastra agent
    const response = await axios.post(
      `${MASTRA_BASE_URL}/api/agents/${AGENT_ID}/generate`,
      {
        messages: [{ role: 'user', content }],
        maxSteps: 5
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );
    
    // Get TOPDOWN's response
    const reply = response.data.text;
    
    // Only send if we have a response
    if (reply) {
      // Send response
      if (reply.length > 2000) {
        // Split long messages
        for (let i = 0; i < reply.length; i += 2000) {
          await message.reply(reply.substring(i, i + 2000));
        }
      } else {
        await message.reply(reply);
      }
    }
  } catch (error) {
    // Log error but don't send error message if we got a partial response
    console.error('Mastra API Error:', error.response?.status || error.message);
    
    // Only send error if we really couldn't connect
    if (!error.response || error.response.status >= 500) {
      await message.reply("System offline.");
    }
  }
});

// Login
client.login(DISCORD_TOKEN);