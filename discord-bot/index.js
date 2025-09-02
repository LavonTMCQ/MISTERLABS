require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const axios = require('axios');

// Bot configuration
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const MASTRA_BASE_URL = process.env.MASTRA_BASE_URL || 'https://cloud.mastra.ai';
const AGENT_ID = process.env.AGENT_ID || 'topdownV1';

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
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
  
  // Only respond when mentioned or in DMs
  const mentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1;
  
  if (!mentioned && !isDM) return;
  
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
    
    const reply = response.data.text || "I'm not sure what to say.";
    
    // Send response
    if (reply.length > 2000) {
      // Split long messages
      for (let i = 0; i < reply.length; i += 2000) {
        await message.reply(reply.substring(i, i + 2000));
      }
    } else {
      await message.reply(reply);
    }
  } catch (error) {
    console.error('Error:', error.message);
    await message.reply("I'm having trouble connecting right now.");
  }
});

// Login
client.login(DISCORD_TOKEN);