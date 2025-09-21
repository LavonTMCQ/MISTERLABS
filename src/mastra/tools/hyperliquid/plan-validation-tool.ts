import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// Zod schema mirroring the LLM-required JSON shape
const PositionSchema = z.object({
  market: z.string(),
  direction: z.enum(["long", "short"]),
  size: z.number().nonnegative(),
  reasoning: z.array(z.string()).optional().default([]),
  leverage: z.number().int().positive().optional(),
});

const PlanSchema = z.object({
  positions_to_maintain: z.array(PositionSchema),
  positions_to_modify: z.array(PositionSchema),
  positions_to_open: z.array(PositionSchema),
});

const ExistingPositionSchema = z.object({
  market: z.string(),
  direction: z.enum(["long", "short"]),
  size: z.number().nonnegative(),
});

export const validatePortfolioPlan = createTool({
  id: "Validate portfolio action plan",
  description:
    "Validate a proposed portfolio action plan JSON against sizing, buffer, and leverage constraints.",
  inputSchema: z.object({
    availableBalance: z.number().positive(),
    planJson: z.string(), // raw JSON string returned by the LLM
    existingPositions: z.array(ExistingPositionSchema).optional().default([]),
    minOrderUsd: z.number().positive().default(10),
    safetyBufferPct: z.number().min(0).max(1).default(0.10),
  }),
  execute: async ({ context }) => {
    const warnings: string[] = [];
    const errors: string[] = [];

    let parsed: z.infer<typeof PlanSchema> | null = null;
    try {
      parsed = PlanSchema.parse(JSON.parse(context.planJson));
    } catch (e: any) {
      return { valid: false, errors: ["Plan JSON parse/validation error", e.message] };
    }

    const { availableBalance, existingPositions, minOrderUsd, safetyBufferPct } = context;

    // Map existing for lookup
    const existingMap = new Map<string, { direction: string; size: number }>();
    existingPositions.forEach(p => existingMap.set(p.market.toUpperCase(), { direction: p.direction, size: p.size }));

    const checkPosition = (p: any, category: string) => {
      if (p.size < minOrderUsd && p.size !== 0) {
        errors.push(`${category}:${p.market} size ${p.size} below minimum ${minOrderUsd}`);
      }
      if (p.size > availableBalance) {
        errors.push(`${category}:${p.market} size ${p.size} exceeds availableBalance ${availableBalance}`);
      }
    };

    parsed.positions_to_maintain.forEach(p => checkPosition(p, "maintain"));
    parsed.positions_to_modify.forEach(p => checkPosition(p, "modify"));
    parsed.positions_to_open.forEach(p => checkPosition(p, "open"));

    // Compute incremental capital usage
    let incrementalUsage = 0;
    const addIncremental = (p: any, category: string) => {
      const key = p.market.toUpperCase();
      const existing = existingMap.get(key);
      if (!existing) {
        // Entire size counts as new capital
        incrementalUsage += p.size;
        return;
      }
      if (p.size === 0) return; // closing frees capital, not usage
      if (existing.direction === p.direction) {
        if (p.size > existing.size) {
          incrementalUsage += p.size - existing.size;
        }
      } else {
        // Flipping direction counts as full new size (conservative)
        incrementalUsage += p.size;
      }
    };

    parsed.positions_to_modify.forEach(p => addIncremental(p, "modify"));
    parsed.positions_to_open.forEach(p => addIncremental(p, "open"));

    const requiredBuffer = Math.max(minOrderUsd, availableBalance * safetyBufferPct);
    const remainingAfter = availableBalance - incrementalUsage;

    if (remainingAfter < requiredBuffer) {
      errors.push(
        `Safety buffer breached: remaining ${remainingAfter.toFixed(2)} < required buffer ${requiredBuffer.toFixed(2)}`
      );
    } else if (remainingAfter < requiredBuffer * 1.25) {
      warnings.push(
        `Remaining balance ${remainingAfter.toFixed(2)} only modestly above buffer ${requiredBuffer.toFixed(2)}`
      );
    }

    // Concentration check (post-mod + opens approximated)
    const aggregateExposure = new Map<string, number>();

    existingPositions.forEach(p => {
      aggregateExposure.set(p.market.toUpperCase(), p.size);
    });

    // Apply modifications / opens to approximate new exposure
    parsed.positions_to_modify.forEach(p => {
      aggregateExposure.set(p.market.toUpperCase(), p.size);
    });
    parsed.positions_to_open.forEach(p => {
      const key = p.market.toUpperCase();
      const prior = aggregateExposure.get(key) || 0;
      aggregateExposure.set(key, prior + p.size);
    });

    const totalExposure = Array.from(aggregateExposure.values()).reduce((a, b) => a + b, 0);
    if (totalExposure > 0) {
      for (const [m, sz] of aggregateExposure.entries()) {
        const pct = sz / totalExposure;
        if (pct > 0.40) warnings.push(`Concentration: ${m} ~${(pct * 100).toFixed(1)}% of modeled exposure`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      incrementalUsage: Number(incrementalUsage.toFixed(2)),
      remainingAfter: Number(remainingAfter.toFixed(2)),
      requiredBuffer: Number(requiredBuffer.toFixed(2)),
      totalExposure: Number(totalExposure.toFixed(2)),
      concentration: Array.from(aggregateExposure.entries()).map(([market, size]) => ({ market, size })),
      plan: parsed,
    };
  },
});