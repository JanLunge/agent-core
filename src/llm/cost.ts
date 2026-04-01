import type { LLMProvider, LLMRequest, Usage, StreamChunk } from './types.js';

// Cost per 1M tokens: [input, output]
const MODEL_COSTS: Record<string, [number, number]> = {
  'gpt-4o': [2.5, 10],
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4-turbo': [10, 30],
  'gpt-4': [30, 60],
  'gpt-3.5-turbo': [0.5, 1.5],
  'claude-3-5-sonnet-20241022': [3, 15],
  'claude-3-5-haiku-20241022': [0.8, 4],
  'claude-3-opus-20240229': [15, 75],
  'claude-sonnet-4-20250514': [3, 15],
  'claude-haiku-4-20250514': [0.8, 4],
  'claude-opus-4-20250514': [15, 75],
  'o1': [15, 60],
  'o1-mini': [3, 12],
  'o3-mini': [1.1, 4.4],
};

const DEFAULT_COST: [number, number] = [1, 2];

interface ModelStats {
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
}

interface CostStats {
  byModel: Map<string, ModelStats>;
  total: ModelStats;
}

function lookupCost(model: string): [number, number] {
  // Try exact match first, then prefix match for versioned model names
  if (MODEL_COSTS[model]) return MODEL_COSTS[model];
  for (const key of Object.keys(MODEL_COSTS)) {
    if (model.startsWith(key)) return MODEL_COSTS[key];
  }
  return DEFAULT_COST;
}

function estimateCost(model: string, usage: Usage): number {
  const [inputPer1M, outputPer1M] = lookupCost(model);
  return (
    (usage.promptTokens / 1_000_000) * inputPer1M +
    (usage.completionTokens / 1_000_000) * outputPer1M
  );
}

export class CostTracker {
  private stats: Map<string, ModelStats> = new Map();

  record(model: string, usage: Usage): void {
    const existing = this.stats.get(model) ?? {
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
    };
    existing.promptTokens += usage.promptTokens;
    existing.completionTokens += usage.completionTokens;
    existing.estimatedCostUsd += estimateCost(model, usage);
    this.stats.set(model, existing);
  }

  getStats(): CostStats {
    const total: ModelStats = {
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
    };
    for (const s of this.stats.values()) {
      total.promptTokens += s.promptTokens;
      total.completionTokens += s.completionTokens;
      total.estimatedCostUsd += s.estimatedCostUsd;
    }
    return { byModel: new Map(this.stats), total };
  }

  reset(): void {
    this.stats.clear();
  }
}

export function createCostTrackingProvider(
  provider: LLMProvider,
  tracker: CostTracker,
): LLMProvider {
  return {
    name: provider.name,

    async complete(req: LLMRequest) {
      const response = await provider.complete(req);
      tracker.record(response.model, response.usage);
      return response;
    },

    async *stream(req: LLMRequest): AsyncIterable<StreamChunk> {
      let lastUsage: Usage | undefined;
      let lastModel: string | undefined;
      for await (const chunk of provider.stream(req)) {
        if (chunk.usage) lastUsage = chunk.usage;
        if (chunk.type === 'done' && chunk.usage) {
          lastUsage = chunk.usage;
        }
        yield chunk;
      }
      if (lastUsage) {
        tracker.record(lastModel ?? req.model, lastUsage);
      }
    },
  };
}
