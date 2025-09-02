require('dotenv').config();
const { Client, GatewayIntentBits, Events, Collection } = require('discord.js');
const axios = require('axios');

// Bot configuration
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const MASTRA_BASE_URL = process.env.MASTRA_BASE_URL || 'https://cloud.mastra.ai';
const AGENT_ID = process.env.AGENT_ID || 'topdownV1';

// Create Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// Track conversations per channel
const conversations = new Collection();

// TOPDOWN v1 personality prefix
const SYSTEM_PREFIX = '[TOPDOWN v1]';

// Helper function to call Mastra agent
async function callMastraAgent(message, conversationHistory = []) {
  try {
    const endpoint = `${MASTRA_BASE_URL}/api/agents/${AGENT_ID}/generate`;
    
    // Add current message to history
    const messages = [
      ...conversationHistory,
      { role: 'user', content: message }
    ];
    
    console.log(`Calling Mastra endpoint: ${endpoint}`);
    
    const response = await axios.post(endpoint, {
      messages,
      maxSteps: 5
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000 // 30 second timeout
    });
    
    return response.data.text || 'NULL_RESPONSE';
  } catch (error) {
    console.error('Mastra API Error:', error.response?.data || error.message);
    
    // TOPDOWN v1 style error responses
    if (error.response?.status === 404) {
      return 'FAILURE: AGENT_NOT_FOUND';
    } else if (error.response?.status === 401) {
      return 'FAILURE: AUTHENTICATION_ERROR';
    } else if (error.code === 'ECONNABORTED') {
      return 'FAILURE: TIMEOUT';
    } else {
      return `FAILURE: ${error.response?.status || 'CONNECTION_ERROR'}`;
    }
  }
}

// Bot ready event
client.once(Events.ClientReady, (c) => {
  console.log(`${SYSTEM_PREFIX} OPERATIONAL. Connected as ${c.user.tag}`);
  console.log(`Mastra endpoint: ${MASTRA_BASE_URL}/api/agents/${AGENT_ID}`);
  
  // Set bot status
  client.user.setPresence({
    activities: [{ name: 'MISTERLABS MAINFRAME', type: 2 }],
    status: 'online',
  });
});

// Message handler
client.on(Events.MessageCreate, async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;
  
  // Check if bot is mentioned or message starts with prefix
  const botMentioned = message.mentions.has(client.user);
  const prefix = '!topdown';
  const hasPrefix = message.content.toLowerCase().startsWith(prefix);
  
  if (!botMentioned && !hasPrefix) return;
  
  // Clean the message content
  let content = message.content;
  if (botMentioned) {
    content = content.replace(`<@${client.user.id}>`, '').trim();
  } else if (hasPrefix) {
    content = content.slice(prefix.length).trim();
  }
  
  // Handle system commands
  if (content.toLowerCase() === 'status') {
    await message.reply(`${SYSTEM_PREFIX} OPERATIONAL. Endpoint: ${MASTRA_BASE_URL}`);
    return;
  }
  
  if (content.toLowerCase() === 'clear') {
    conversations.delete(message.channelId);
    await message.reply(`${SYSTEM_PREFIX} Memory cleared.`);
    return;
  }
  
  if (content.toLowerCase() === 'help') {
    await message.reply(`${SYSTEM_PREFIX} Commands:
\`!topdown [query]\` - Query TOPDOWN v1
\`!topdown status\` - System status
\`!topdown clear\` - Clear conversation memory
Mention me directly to interact.`);
    return;
  }
  
  // Show typing indicator
  await message.channel.sendTyping();
  
  // Get conversation history for this channel
  const channelHistory = conversations.get(message.channelId) || [];
  
  // Call Mastra agent
  const response = await callMastraAgent(content, channelHistory);
  
  // Update conversation history
  channelHistory.push(
    { role: 'user', content },
    { role: 'assistant', content: response }
  );
  
  // Keep only last 10 messages in history
  if (channelHistory.length > 20) {
    channelHistory.splice(0, channelHistory.length - 20);
  }
  
  conversations.set(message.channelId, channelHistory);
  
  // Send response
  if (response.length > 2000) {
    // Split long messages
    const chunks = response.match(/.{1,2000}/g) || [];
    for (const chunk of chunks) {
      await message.reply(`${SYSTEM_PREFIX} ${chunk}`);
    }
  } else {
    await message.reply(`${SYSTEM_PREFIX} ${response}`);
  }
});

// Handle slash commands (optional)
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  const { commandName } = interaction;
  
  if (commandName === 'topdown') {
    const query = interaction.options.getString('query');
    
    await interaction.deferReply();
    
    const response = await callMastraAgent(query);
    await interaction.editReply(`${SYSTEM_PREFIX} ${response}`);
  }
});

// Error handling
client.on('error', (error) => {
  console.error(`${SYSTEM_PREFIX} ERROR:`, error);
});

process.on('unhandledRejection', (error) => {
  console.error(`${SYSTEM_PREFIX} UNHANDLED_REJECTION:`, error);
});

// Login to Discord
client.login(DISCORD_TOKEN).catch((error) => {
  console.error(`${SYSTEM_PREFIX} FAILURE: Unable to connect to Discord.`, error);
  process.exit(1);
});