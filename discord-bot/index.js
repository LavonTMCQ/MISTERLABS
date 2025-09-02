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

// Track processed messages (clear old ones after 5 minutes)
const processedMessages = new Set();
setInterval(() => {
  const size = processedMessages.size;
  if (size > 100) {
    processedMessages.clear();
    console.log(`🧹 Cleared ${size} processed message IDs`);
  }
}, 5 * 60 * 1000);

// Message handler
client.on(Events.MessageCreate, async (message) => {
  // Ignore ALL bots including ourselves
  if (message.author.bot) return;
  
  // Double-check we're not responding to ourselves
  if (message.author.id === client.user.id) {
    console.log(`⚠️ Ignoring our own message: ${message.id}`);
    return;
  }
  
  // Check if we already processed this message
  if (processedMessages.has(message.id)) {
    console.log(`⚠️ Duplicate message detected: ${message.id}`);
    return;
  }
  processedMessages.add(message.id);
  
  // Only respond when mentioned
  const mentioned = message.mentions.has(client.user);
  
  if (!mentioned) return;
  
  // Clean message (remove mention)
  let content = message.content;
  if (mentioned) {
    content = content.replace(/<@!?\d+>/g, '').trim();
  }
  
  if (!content) return;
  
  console.log(`📥 Processing message ${message.id}: "${content}"`);
  
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
      console.log(`📤 Sending response for message ${message.id}: "${reply.substring(0, 50)}..."`);
      // Send response (using channel.send instead of reply to avoid reply chains)
      if (reply.length > 2000) {
        // Split long messages
        for (let i = 0; i < reply.length; i += 2000) {
          await message.channel.send(reply.substring(i, i + 2000));
        }
      } else {
        await message.channel.send(reply);
      }
      console.log(`✅ Response sent for message ${message.id}`);
    }
  } catch (error) {
    // Log error but don't send error message if we got a partial response
    console.error('Mastra API Error:', error.response?.status || error.message);
    
    // Only send error if we really couldn't connect
    if (!error.response || error.response.status >= 500) {
      await message.channel.send("System offline.");
    }
  }
});

// Login
client.login(DISCORD_TOKEN);