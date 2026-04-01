/** Rough token estimate: ~4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface TokenBudget {
  total: number;
  reserved: {
    system: number;
    history: number;
    response: number;
  };
}

/** Creates a token budget: 30% system, 50% history, 20% response. */
export function createBudget(maxTokens: number): TokenBudget {
  return {
    total: maxTokens,
    reserved: {
      system: Math.floor(maxTokens * 0.3),
      history: Math.floor(maxTokens * 0.5),
      response: Math.floor(maxTokens * 0.2),
    },
  };
}
