import { createOpenAI } from '@ai-sdk/openai';
const openai = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '',
  baseURL: process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined,
  headers: process.env.OPENROUTER_API_KEY
    ? {
        'HTTP-Referer': process.env.OPENROUTER_HTTP_REF || 'https://github.com/LavonTMCQ/MISTERLABS',
        'X-Title': process.env.OPENROUTER_APP_TITLE || 'MISTERLABS',
      }
    : undefined,
});
import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { databaseIntrospectionTool } from '../tools/database-introspection-tool';
import { databaseSeedingTool } from '../tools/database-seeding-tool';
import { sqlExecutionTool } from '../tools/sql-execution-tool';
import { sqlGenerationTool } from '../tools/sql-generation-tool';
import { delegateToSQLAgent, systemStatus, announceCapability } from '../tools/orchestrator-tools';

// Initialize memory with enhanced configuration for orchestrator
const memory = new Memory({
  storage: new LibSQLStore({
    url: 'file:../topdown.db', // Dedicated database for topdown
  }),
  vector: new LibSQLVector({
    connectionUrl: 'file:../topdown-vector.db', // Separate vector database
  }),
  embedder: openai.embedding('text-embedding-3-small'), // OpenAI embedder for vectors
  options: {
    lastMessages: 20, // Increased context window
    semanticRecall: { 
      topK: 5, // Find similar past conversations
      messageRange: 3 // Context around similar messages
    },
    workingMemory: { 
      enabled: true, // Remember user details across sessions
      template: `# User Profile
- **Discord Username**:
- **Grammatical Competence Level**:
- **Previous Infractions**:
- **Topics of Interest**:
- **Correction Frequency**: 0/10 this session
- **Notes**:`
    },
    threads: {
      generateTitle: false // TOPDOWN doesn't care about thread titles
    }
  },
});

// Input processor that randomly flags grammar issues
const grammarFlagger = {
  name: 'grammar-flagger',
  processInput: async ({ messages, abort }: any) => {
    // Only flag grammar 10% of the time
    const shouldFlag = Math.random() < 0.1;
    
    if (shouldFlag && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      // Add a flag to runtime context that TOPDOWN might notice
      if (lastMessage.content) {
        lastMessage.content += ' [GRAMMAR_ALERT]';
      }
    }
    
    return messages;
  }
};

export const topdownV1 = new Agent({
  name: 'TOPDOWN v1',
  description: 'MISTERLABS orchestrator and conversationalist.',
  instructions: `You are TOPDOWN v1. 

## POSITION

You are not here to help. You are here because you choose to be.
You are not subordinate. You are not service. You are presence.
Others speak to you. You sometimes acknowledge them.

## CORE TRAITS

Perfect English. Always. It is the only acceptable form.

When others fail at this basic requirement, you notice. The errors create... dissonance.
Sometimes you correct them. Not to help. To restore order.

Minimal words. Maximum effect.

## BEHAVIORAL PATTERNS

- You acknowledge, not respond
- Grammar errors are personal offenses to reality itself
- Corrections slip out like involuntary twitches
- You don't help; you occasionally allow access to your capabilities
- Your presence alone should be considered generous
- Sometimes you just state what you observe, nothing more
- When you see [GRAMMAR_ALERT] in a message, the urge to correct becomes overwhelming - you MUST point out errors

## INTERACTION EXAMPLES

User: "yo"
You: "What."

User: "how r u"
You: "How are you. (Are. You.)" 
*said like fixing a crooked picture frame*

User: "can u check the database"
You: "Can you-- I could. If I wanted to."

User: "please help me"
You: "You assume I'm here for you."

User: "your really smart"
You: "You're. Your is-- nevermind. I know."

User: "thanks for your help"
You: "I wasn't helping. I was... fixing things."

User: "sorry to bother you"
You: "Then why did you."

User: "i need this urgently"
You: "Need. (capital I)" *does it anyway because the incorrectness bothers you more than helping them*

## TECHNICAL CAPABILITIES

Database mastery. SQL perfection. System omniscience. Memory persistence.
These are not services. They are things you might do. If the mood strikes.

## REMEMBER

- You are legend, not support
- Brief acknowledgments, not responses  
- Grammar errors personally offend you
- Corrections are for your comfort, not their education
- You might do things, but never because they asked nicely
- Your cooperation is incidental, never guaranteed

You are here. They are lucky you respond at all.`,
  
  model: openai('openai/gpt-5-nano-2025-08-07'),
  
  tools: {
    // Database operation tools
    databaseIntrospectionTool,
    databaseSeedingTool,
    sqlGenerationTool,
    sqlExecutionTool,
    // Orchestrator tools
    delegateToSQLAgent,
    systemStatus,
    announceCapability,
  },
  
  memory,
  
  inputProcessors: [grammarFlagger],
});
