import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

// Schemas for trading workflow data structures
const userProfileSchema = z.object({
  risk_level: z.string(),
  token_preferences: z.string(),
  mission_statement: z.string(),
  chat_personality: z.string().optional(),
  trading_experience: z.enum(["beginner", "intermediate", "advanced"]).default("intermediate"),
  max_position_size_pct: z.number().min(0).max(100).default(25),
  preferred_leverage: z.number().min(1).max(50).default(5),
});

const positionSchema = z.object({
  market: z.string(),
  direction: z.enum(["long", "short"]),
  size: z.number(),
  leverage: z.number().optional(),
  unrealized_pnl: z.number().optional(),
  entry_price: z.number().optional(),
});

const tradingContextSchema = z.object({
  user_profile: userProfileSchema,
  available_balance: z.number(),
  current_positions: z.array(positionSchema),
  market_conditions: z.object({
    volatility: z.string(),
    trend: z.string(),
    sentiment: z.string(),
  }).optional(),
});

const tradingPlanSchema = z.object({
  user_profile_summary: z.string(),
  market_assessment: z.string(),
  positions_to_maintain: z.array(z.object({
    market: z.string(),
    direction: z.enum(["long", "short"]),
    size: z.number(),
    reasoning: z.array(z.string()),
    leverage: z.number().optional(),
    confidence: z.enum(["low", "medium", "high"]).optional(),
    risk_reward: z.string().optional(),
  })),
  positions_to_modify: z.array(z.object({
    market: z.string(),
    direction: z.enum(["long", "short"]),
    size: z.number(),
    reasoning: z.array(z.string()),
    leverage: z.number().optional(),
    confidence: z.enum(["low", "medium", "high"]).optional(),
    risk_reward: z.string().optional(),
  })),
  positions_to_open: z.array(z.object({
    market: z.string(),
    direction: z.enum(["long", "short"]),
    size: z.number(),
    reasoning: z.array(z.string()),
    leverage: z.number().optional(),
    confidence: z.enum(["low", "medium", "high"]).optional(),
    risk_reward: z.string().optional(),
  })),
});

// Step 1: Gather comprehensive trading context
const gatherTradingContext = createStep({
  id: 'gather-trading-context',
  description: 'Gather user profile, portfolio state, and market context for trading decisions',
  inputSchema: z.object({
    user_query: z.string().describe('User\'s trading request or question'),
    user_wallet: z.string().optional().describe('User wallet address for portfolio analysis'),
  }),
  outputSchema: tradingContextSchema,
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error('Input data not found');
    }

    // In production, these would be actual API calls
    // For now, we'll simulate comprehensive data gathering
    const mockUserProfile = {
      risk_level: "Moderate risk, willing to risk some money for the right investments but not chasing every new opportunity",
      token_preferences: "Likes ETH more than BTC, doesn't like SOL", 
      mission_statement: "Accumulate as much ETH as possible given the available funds",
      chat_personality: "Analytical and methodical trader",
      trading_experience: "intermediate" as const,
      max_position_size_pct: 25,
      preferred_leverage: 5,
    };

    const mockCurrentPositions = [
      {
        market: "ATOM",
        direction: "long" as const,
        size: 5123.86,
        leverage: 20,
        unrealized_pnl: -268.58,
        entry_price: 10.97,
      },
      {
        market: "BTC", 
        direction: "short" as const,
        size: 15224.59,
        leverage: 20,
        unrealized_pnl: -10244.08,
        entry_price: 31538.2,
      },
      {
        market: "ETH",
        direction: "short" as const,
        size: 10513.81,
        leverage: 20,
        unrealized_pnl: -4844.93,
        entry_price: 2008.46,
      },
    ];

    const mockMarketConditions = {
      volatility: "moderate",
      trend: "sideways_with_upward_bias", 
      sentiment: "cautiously_optimistic",
    };

    return {
      user_profile: mockUserProfile,
      available_balance: 325491.64, // Mock available balance
      current_positions: mockCurrentPositions,
      market_conditions: mockMarketConditions,
    };
  },
});

// Step 2: Generate trading recommendations using the agent
const generateTradingPlan = createStep({
  id: 'generate-trading-plan',
  description: 'Use trading agent to generate personalized trading recommendations',
  inputSchema: tradingContextSchema,
  outputSchema: tradingPlanSchema,
  execute: async ({ inputData, mastra }) => {
    const context = inputData;
    if (!context) {
      throw new Error('Trading context not found');
    }

    const agent = mastra?.getAgent('tradingAgent');
    if (!agent) {
      throw new Error('Trading agent not found');
    }

    // Format context for the agent
    const userMessage = `
# Trading Portfolio Analysis Request

## User Profile
- Risk Level: ${context.user_profile.risk_level}
- Token Preferences: ${context.user_profile.token_preferences}
- Mission Statement: ${context.user_profile.mission_statement}
- Trading Experience: ${context.user_profile.trading_experience}
- Max Position Size: ${context.user_profile.max_position_size_pct}% of portfolio
- Preferred Leverage: ${context.user_profile.preferred_leverage}x

## Portfolio State
- Available Balance: $${context.available_balance.toLocaleString()}
- Current Positions: ${context.current_positions.length} active positions

${context.current_positions.map(pos => 
  `- ${pos.market} ${pos.direction}: $${pos.size.toLocaleString()} (${pos.leverage}x leverage, PnL: $${pos.unrealized_pnl?.toLocaleString()})`
).join('\n')}

## Market Context
- Volatility: ${context.market_conditions?.volatility}
- Trend: ${context.market_conditions?.trend}
- Sentiment: ${context.market_conditions?.sentiment}

Please provide trading recommendations in the required JSON format.
`;

    const response = await agent.stream([
      {
        role: 'user',
        content: userMessage,
      },
    ]);

    let planText = '';
    for await (const chunk of response.textStream) {
      planText += chunk;
    }

    // Try to parse the JSON response
    let tradingPlan;
    try {
      // Extract JSON from the response (agent might include other text)
      const jsonMatch = planText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        tradingPlan = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in agent response');
      }
    } catch (error) {
      // Fallback to mock plan if parsing fails
      tradingPlan = {
        user_profile_summary: "ETH-focused moderate risk trader seeking accumulation opportunities",
        market_assessment: "Market showing consolidation with selective ETH strength",
        positions_to_maintain: [
          {
            market: "ATOM",
            direction: "long",
            size: 5123.86,
            reasoning: ["Small position with manageable loss", "Potential for recovery"],
            leverage: 20,
            confidence: "medium",
            risk_reward: "2:1 potential recovery"
          }
        ],
        positions_to_modify: [
          {
            market: "ETH", 
            direction: "long",
            size: 10523.81,
            reasoning: ["Flip short to align with ETH accumulation mission", "Technical reversal signals", "User preference for ETH"],
            leverage: 5,
            confidence: "high", 
            risk_reward: "3:1 upside with mission alignment"
          }
        ],
        positions_to_open: []
      };
    }

    return tradingPlan;
  },
});

// Step 3: Validate the trading plan
const validateTradingPlan = createStep({
  id: 'validate-trading-plan',
  description: 'Validate trading plan against risk constraints and position limits',
  inputSchema: z.object({
    plan: tradingPlanSchema,
    context: tradingContextSchema,
  }),
  outputSchema: z.object({
    validation_result: z.object({
      valid: z.boolean(),
      errors: z.array(z.string()),
      warnings: z.array(z.string()),
      risk_score: z.number(),
      recommendations: z.array(z.string()),
    }),
    validated_plan: tradingPlanSchema,
  }),
  execute: async ({ inputData }) => {
    const { plan, context } = inputData!;

    // Simulate validation logic
    const errors: string[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    // Check position sizes against available balance
    const totalNewCapital = [
      ...plan.positions_to_open,
      ...plan.positions_to_modify
    ].reduce((sum, pos) => sum + pos.size, 0);

    const safetyBuffer = context.available_balance * 0.15; // 15% buffer
    const maxUsableCapital = context.available_balance - safetyBuffer;

    if (totalNewCapital > maxUsableCapital) {
      errors.push(`Total new capital deployment $${totalNewCapital.toLocaleString()} exceeds safe limit $${maxUsableCapital.toLocaleString()}`);
    }

    // Check individual position sizes against user's max position size
    const maxPositionSize = context.available_balance * (context.user_profile.max_position_size_pct / 100);
    
    [...plan.positions_to_open, ...plan.positions_to_modify].forEach(pos => {
      if (pos.size > maxPositionSize) {
        warnings.push(`Position ${pos.market} size $${pos.size.toLocaleString()} exceeds max position limit $${maxPositionSize.toLocaleString()}`);
      }
    });

    // Check leverage against user preferences
    [...plan.positions_to_open, ...plan.positions_to_modify].forEach(pos => {
      if (pos.leverage && pos.leverage > context.user_profile.preferred_leverage * 2) {
        warnings.push(`Position ${pos.market} leverage ${pos.leverage}x significantly exceeds preferred ${context.user_profile.preferred_leverage}x`);
      }
    });

    // Calculate risk score (0-100)
    let riskScore = 0;
    riskScore += errors.length * 30; // Major issues
    riskScore += warnings.length * 15; // Minor issues
    riskScore += Math.min(30, (totalNewCapital / context.available_balance) * 100); // Capital utilization

    // Generate recommendations
    if (warnings.length > 0) {
      recommendations.push("Consider reducing position sizes to stay within preferred limits");
    }
    if (riskScore > 70) {
      recommendations.push("High risk detected - consider more conservative approach");
    }
    if (plan.positions_to_open.length === 0 && plan.positions_to_modify.length === 0) {
      recommendations.push("No new positions suggested - consider if opportunities are being missed");
    }

    return {
      validation_result: {
        valid: errors.length === 0,
        errors,
        warnings,
        risk_score: Math.min(100, riskScore),
        recommendations,
      },
      validated_plan: plan,
    };
  },
});

// Step 4: Format final recommendations
const formatTradingRecommendations = createStep({
  id: 'format-trading-recommendations', 
  description: 'Format validated trading plan into user-friendly recommendations',
  inputSchema: z.object({
    validation_result: z.object({
      valid: z.boolean(),
      errors: z.array(z.string()),
      warnings: z.array(z.string()),
      risk_score: z.number(),
      recommendations: z.array(z.string()),
    }),
    validated_plan: tradingPlanSchema,
    context: tradingContextSchema,
  }),
  outputSchema: z.object({
    formatted_recommendations: z.string(),
    execution_ready: z.boolean(),
    risk_assessment: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { validation_result, validated_plan, context } = inputData!;

    let formatted = `# 🎯 Personalized Trading Recommendations\n\n`;
    
    // User profile summary
    formatted += `## 👤 Profile Summary\n${validated_plan.user_profile_summary}\n\n`;
    
    // Market assessment
    formatted += `## 📊 Market Assessment\n${validated_plan.market_assessment}\n\n`;

    // Risk assessment
    const riskLevel = validation_result.risk_score <= 30 ? "LOW" : 
                     validation_result.risk_score <= 60 ? "MEDIUM" : "HIGH";
    formatted += `## ⚠️ Risk Assessment: ${riskLevel} (${validation_result.risk_score}/100)\n\n`;

    // Validation status
    if (!validation_result.valid) {
      formatted += `## ❌ Validation Errors\n`;
      validation_result.errors.forEach(error => {
        formatted += `- ${error}\n`;
      });
      formatted += `\n`;
    }

    if (validation_result.warnings.length > 0) {
      formatted += `## ⚠️ Warnings\n`;
      validation_result.warnings.forEach(warning => {
        formatted += `- ${warning}\n`;
      });
      formatted += `\n`;
    }

    // Trading actions
    if (validated_plan.positions_to_maintain.length > 0) {
      formatted += `## 🔄 Positions to Maintain\n`;
      validated_plan.positions_to_maintain.forEach(pos => {
        formatted += `### ${pos.market} ${pos.direction.toUpperCase()}\n`;
        formatted += `- Size: $${pos.size.toLocaleString()}\n`;
        formatted += `- Confidence: ${pos.confidence}\n`;
        formatted += `- Risk/Reward: ${pos.risk_reward}\n`;
        formatted += `- Reasoning:\n`;
        pos.reasoning.forEach(reason => formatted += `  - ${reason}\n`);
        formatted += `\n`;
      });
    }

    if (validated_plan.positions_to_modify.length > 0) {
      formatted += `## 🔄 Positions to Modify\n`;
      validated_plan.positions_to_modify.forEach(pos => {
        formatted += `### ${pos.market} ${pos.direction.toUpperCase()}\n`;
        formatted += `- New Size: $${pos.size.toLocaleString()}\n`;
        formatted += `- Leverage: ${pos.leverage}x\n`;
        formatted += `- Confidence: ${pos.confidence}\n`;
        formatted += `- Risk/Reward: ${pos.risk_reward}\n`;
        formatted += `- Reasoning:\n`;
        pos.reasoning.forEach(reason => formatted += `  - ${reason}\n`);
        formatted += `\n`;
      });
    }

    if (validated_plan.positions_to_open.length > 0) {
      formatted += `## 🆕 New Positions to Open\n`;
      validated_plan.positions_to_open.forEach(pos => {
        formatted += `### ${pos.market} ${pos.direction.toUpperCase()}\n`;
        formatted += `- Size: $${pos.size.toLocaleString()}\n`;
        formatted += `- Leverage: ${pos.leverage}x\n`;
        formatted += `- Confidence: ${pos.confidence}\n`;
        formatted += `- Risk/Reward: ${pos.risk_reward}\n`;
        formatted += `- Reasoning:\n`;
        pos.reasoning.forEach(reason => formatted += `  - ${reason}\n`);
        formatted += `\n`;
      });
    }

    // Recommendations
    if (validation_result.recommendations.length > 0) {
      formatted += `## 💡 Additional Recommendations\n`;
      validation_result.recommendations.forEach(rec => {
        formatted += `- ${rec}\n`;
      });
      formatted += `\n`;
    }

    // Summary
    const totalPositions = validated_plan.positions_to_maintain.length + 
                          validated_plan.positions_to_modify.length + 
                          validated_plan.positions_to_open.length;
    
    formatted += `## 📋 Summary\n`;
    formatted += `- Total Actions: ${totalPositions}\n`;
    formatted += `- Risk Score: ${validation_result.risk_score}/100\n`;
    formatted += `- Validation Status: ${validation_result.valid ? "✅ PASSED" : "❌ FAILED"}\n`;

    return {
      formatted_recommendations: formatted,
      execution_ready: validation_result.valid && validation_result.risk_score <= 70,
      risk_assessment: `${riskLevel} risk (${validation_result.risk_score}/100)`,
    };
  },
});

// Step to combine plan with context for validation
const combinePlanWithContext = createStep({
  id: 'combine-plan-with-context',
  description: 'Combine trading plan with context for validation',
  inputSchema: tradingPlanSchema,
  outputSchema: z.object({
    plan: tradingPlanSchema,
    context: tradingContextSchema,
  }),
  execute: async ({ inputData }) => {
    const plan = inputData;
    if (!plan) {
      throw new Error('Trading plan not found');
    }

    // Mock context data for validation - in production this would come from the context step
    const context = {
      user_profile: {
        risk_level: "Moderate risk, willing to risk some money for the right investments but not chasing every new opportunity",
        token_preferences: "Likes ETH more than BTC, doesn't like SOL", 
        mission_statement: "Accumulate as much ETH as possible given the available funds",
        chat_personality: "Analytical and methodical trader",
        trading_experience: "intermediate" as const,
        max_position_size_pct: 25,
        preferred_leverage: 5,
      },
      available_balance: 325491.64,
      current_positions: [
        {
          market: "ATOM",
          direction: "long" as const,
          size: 5123.86,
          leverage: 20,
          unrealized_pnl: -268.58,
          entry_price: 10.97,
        },
        {
          market: "BTC", 
          direction: "short" as const,
          size: 15224.59,
          leverage: 20,
          unrealized_pnl: -10244.08,
          entry_price: 31538.2,
        },
        {
          market: "ETH",
          direction: "short" as const,
          size: 10513.81,
          leverage: 20,
          unrealized_pnl: -4844.93,
          entry_price: 2008.46,
        },
      ],
      market_conditions: {
        volatility: "moderate",
        trend: "sideways_with_upward_bias", 
        sentiment: "cautiously_optimistic",
      },
    };

    return {
      plan,
      context,
    };
  },
});

// Create the complete trading workflow
const tradingWorkflow = createWorkflow({
  id: 'trading-workflow',
  inputSchema: z.object({
    user_query: z.string().describe('User\'s trading request or question'),
    user_wallet: z.string().optional().describe('User wallet address for portfolio analysis'),
  }),
  outputSchema: z.object({
    formatted_recommendations: z.string(),
    execution_ready: z.boolean(),
    risk_assessment: z.string(),
  }),
})
  .then(gatherTradingContext)
  .then(generateTradingPlan)
  .then(combinePlanWithContext)
  .then(validateTradingPlan)
  .then(formatTradingRecommendations);

tradingWorkflow.commit();

export { tradingWorkflow };