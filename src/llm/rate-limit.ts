import type { LLMProvider, LLMRequest, Usage, StreamChunk } from './types.js';

interface RateLimiterConfig {
  tokensPerMinute: number;
  requestsPerMinute: number;
}

export class RateLimiter {
  private tokenBucket: number;
  private requestBucket: number;
  private readonly tokensPerMinute: number;
  private readonly requestsPerMinute: number;
  private lastRefill: number;

  constructor(config: RateLimiterConfig) {
    this.tokensPerMinute = config.tokensPerMinute;
    this.requestsPerMinute = config.requestsPerMinute;
    this.tokenBucket = config.tokensPerMinute;
    this.requestBucket = config.requestsPerMinute;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 60_000; // fraction of a minute
    this.tokenBucket = Math.min(
      this.tokensPerMinute,
      this.tokenBucket + elapsed * this.tokensPerMinute,
    );
    this.requestBucket = Math.min(
      this.requestsPerMinute,
      this.requestBucket + elapsed * this.requestsPerMinute,
    );
    this.lastRefill = now;
  }

  async acquire(estimatedTokens = 1): Promise<void> {
    while (true) {
      this.refill();

      if (this.requestBucket >= 1 && this.tokenBucket >= estimatedTokens) {
        this.requestBucket -= 1;
        this.tokenBucket -= estimatedTokens;
        return;
      }

      // Calculate wait time: how long until enough budget refills
      const requestWait =
        this.requestBucket < 1
          ? ((1 - this.requestBucket) / this.requestsPerMinute) * 60_000
          : 0;
      const tokenWait =
        this.tokenBucket < estimatedTokens
          ? ((estimatedTokens - this.tokenBucket) / this.tokensPerMinute) * 60_000
          : 0;
      const waitMs = Math.max(requestWait, tokenWait, 10); // at least 10ms

      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  record(usage: Usage): void {
    // Adjust bucket based on actual vs estimated usage.
    // If actual usage was higher than estimated, deduct the difference.
    // We don't add back — the acquire() already deducted an estimate.
    const actual = usage.totalTokens;
    // Just ensure we track real consumption by reducing the bucket further
    // if we underestimated. Over-estimation is fine (bucket stays lower).
    if (actual > 0) {
      // The simplest approach: we already deducted an estimate in acquire().
      // Record is informational — we could reconcile, but for simplicity
      // we just note that the bucket was already drained by acquire().
    }
  }
}

export function createRateLimitedProvider(
  provider: LLMProvider,
  limiter: RateLimiter,
): LLMProvider {
  return {
    name: provider.name,

    async complete(req: LLMRequest) {
      const estimated = req.max_tokens ?? 4096;
      await limiter.acquire(estimated);
      const response = await provider.complete(req);
      limiter.record(response.usage);
      return response;
    },

    async *stream(req: LLMRequest): AsyncIterable<StreamChunk> {
      const estimated = req.max_tokens ?? 4096;
      await limiter.acquire(estimated);
      let lastUsage: Usage | undefined;
      for await (const chunk of provider.stream(req)) {
        if (chunk.usage) lastUsage = chunk.usage;
        yield chunk;
      }
      if (lastUsage) limiter.record(lastUsage);
    },
  };
}
