import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { tapToolsAPI } from '../../services/taptools-api';
import { tokenLookupService } from '../../services/token-lookup';

/**
 * Calculate risk metrics based on available data
 */
function calculateRiskMetrics(token: any, marketData: any, holderData: any[], totalHolders: number) {
  const metrics = {
    overallRisk: 'MEDIUM' as 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH',
    top10Concentration: 0,
    top20Concentration: 0,
    concentrationRisk: 'MEDIUM' as 'LOW' | 'MEDIUM' | 'HIGH',
    riskFactors: [] as string[]
  };

  // Calculate holder concentration if data available
  if (holderData.length > 0 && token.supply) {
    const totalSupply = token.supply;
    const top10Amount = holderData.slice(0, 10).reduce((sum, holder) => sum + (holder.amount || 0), 0);
    const top20Amount = holderData.slice(0, 20).reduce((sum, holder) => sum + (holder.amount || 0), 0);

    metrics.top10Concentration = (top10Amount / totalSupply) * 100;
    metrics.top20Concentration = (top20Amount / totalSupply) * 100;

    // Assess concentration risk
    if (metrics.top10Concentration > 70) {
      metrics.concentrationRisk = 'HIGH';
      metrics.riskFactors.push('High concentration in top 10 holders');
    } else if (metrics.top10Concentration > 50) {
      metrics.concentrationRisk = 'MEDIUM';
      metrics.riskFactors.push('Moderate concentration in top 10 holders');
    } else {
      metrics.concentrationRisk = 'LOW';
    }
  }

  // Market cap risk assessment
  const marketCap = marketData?.market_cap || token.market_cap;
  if (marketCap) {
    if (marketCap < 100000) {
      metrics.riskFactors.push('Very low market cap (high volatility risk)');
    } else if (marketCap < 1000000) {
      metrics.riskFactors.push('Low market cap (moderate volatility risk)');
    }
  }

  // Holder count risk
  if (totalHolders < 100) {
    metrics.riskFactors.push('Low number of holders');
  } else if (totalHolders < 500) {
    metrics.riskFactors.push('Moderate number of holders');
  }

  // Overall risk calculation
  const riskScore = metrics.riskFactors.length;
  if (riskScore >= 4) {
    metrics.overallRisk = 'VERY_HIGH';
  } else if (riskScore >= 3) {
    metrics.overallRisk = 'HIGH';
  } else if (riskScore >= 2) {
    metrics.overallRisk = 'MEDIUM';
  } else {
    metrics.overallRisk = 'LOW';
  }

  return metrics;
}

/**
 * Generate recommendations based on risk analysis
 */
function generateRecommendations(metrics: any, depth: string): string[] {
  const recommendations = [
    'Always conduct thorough due diligence before investing',
    'Monitor holder distribution and concentration metrics',
    'Track trading volume and liquidity patterns'
  ];

  if (metrics.concentrationRisk === 'HIGH') {
    recommendations.push('Exercise extreme caution due to high holder concentration');
  }

  if (depth === 'comprehensive') {
    recommendations.push(
      'Analyze tokenomics and vesting schedules',
      'Review project roadmap and development activity',
      'Assess competitive landscape and market positioning',
      'Monitor social sentiment and community engagement'
    );
  }

  return recommendations;
}

/**
 * Generate warnings based on risk factors
 */
function generateWarnings(metrics: any): string[] {
  const warnings = [
    'Cryptocurrency investments carry significant risk',
    'Past performance does not guarantee future results'
  ];

  if (metrics.overallRisk === 'VERY_HIGH' || metrics.overallRisk === 'HIGH') {
    warnings.push('This token shows HIGH RISK characteristics - invest with extreme caution');
  }

  if (metrics.concentrationRisk === 'HIGH') {
    warnings.push('High holder concentration may lead to price manipulation');
  }

  return warnings;
}

export const cardanoTokenRiskAnalysis = createTool({
  id: 'cardano-token-risk-analysis',
  description: 'PRIMARY tool for comprehensive Cardano token risk assessment and analysis',
  inputSchema: z.object({
    input: z.string().describe('Token ticker symbol or policy ID to analyze'),
    analysisDepth: z.enum(['basic', 'comprehensive']).default('basic').describe('Level of analysis depth'),
  }),
  execute: async ({ context: { input, analysisDepth } }) => {
    try {
      console.log(`🔍 Starting risk analysis for: ${input}`);

      // Step 1: Resolve token information
      const token = await tokenLookupService.resolveToken(input);
      if (!token) {
        return {
          success: false,
          error: 'Token not found',
          message: `Could not find token information for: ${input}`,
          suggestions: [
            'Check the ticker symbol or policy ID',
            'Ensure the token exists on Cardano',
            'Try using the full policy ID instead of ticker'
          ]
        };
      }

      console.log(`✅ Token resolved: ${token.name} (${token.ticker})`);

      // Step 2: Get market data
      let marketData = null;
      if (token.unit) {
        try {
          marketData = await tapToolsAPI.getTokenMarketData(token.unit);
        } catch (error) {
          console.warn(`⚠️ Failed to get market data: ${error}`);
        }
      }

      // Step 3: Get holder data for concentration analysis
      let holderData: any[] = [];
      let totalHolders = 0;
      if (token.unit) {
        try {
          holderData = await tapToolsAPI.getTokenHolders(token.unit, 20);
          totalHolders = await tapToolsAPI.getTotalHolders(token.unit);
        } catch (error) {
          console.warn(`⚠️ Failed to get holder data: ${error}`);
        }
      }

      // Step 4: Calculate risk metrics
      const riskMetrics = calculateRiskMetrics(token, marketData, holderData, totalHolders);

      // Step 5: Generate comprehensive analysis
      const analysis = {
        token: {
          ticker: token.ticker,
          name: token.name,
          policyId: token.policy_id,
          unit: token.unit
        },
        riskScore: riskMetrics.overallRisk,
        marketData: {
          marketCap: marketData?.market_cap || token.market_cap || 'Unknown',
          price: marketData?.price || token.price || 'Unknown',
          volume24h: marketData?.volume_24h || token.volume_24h || 'Unknown',
          supply: token.supply || 'Unknown'
        },
        holderAnalysis: {
          totalHolders,
          top10Concentration: riskMetrics.top10Concentration,
          top20Concentration: riskMetrics.top20Concentration,
          concentrationRisk: riskMetrics.concentrationRisk
        },
        riskFactors: riskMetrics.riskFactors,
        recommendations: generateRecommendations(riskMetrics, analysisDepth),
        warnings: generateWarnings(riskMetrics),
        timestamp: new Date().toISOString()
      };

      return {
        success: true,
        data: analysis,
        message: `Risk analysis completed for ${token.name} (${token.ticker})`
      };

    } catch (error) {
      console.error(`❌ Risk analysis failed for ${input}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: `Failed to analyze token: ${input}`
      };
    }
  }
});
