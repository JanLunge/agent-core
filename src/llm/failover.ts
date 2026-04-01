import type { LLMProvider, LLMRequest, StreamChunk } from './types.js';

interface FailoverOptions {
  maxRetries?: number;
}

export function createFailoverProvider(
  providers: LLMProvider[],
  opts?: FailoverOptions,
): LLMProvider {
  if (providers.length === 0) {
    throw new Error('createFailoverProvider requires at least one provider');
  }

  const maxRetries = opts?.maxRetries ?? providers.length;
  const candidates = providers.slice(0, maxRetries);

  return {
    name: candidates.map((p) => p.name).join(' \u2192 '),

    async complete(req: LLMRequest) {
      let lastError: unknown;
      for (let i = 0; i < candidates.length; i++) {
        try {
          const response = await candidates[i].complete(req);
          if (i > 0) {
            process.stderr.write(
              `[failover] complete: ${candidates[0].name} failed, using ${candidates[i].name}\n`,
            );
          }
          return response;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError;
    },

    async *stream(req: LLMRequest): AsyncIterable<StreamChunk> {
      let lastError: unknown;
      for (let i = 0; i < candidates.length; i++) {
        try {
          const iter = candidates[i].stream(req);
          // We need to actually attempt to get the first chunk to detect errors
          const iterator = iter[Symbol.asyncIterator]();
          const first = await iterator.next();

          if (i > 0) {
            process.stderr.write(
              `[failover] stream: ${candidates[0].name} failed, using ${candidates[i].name}\n`,
            );
          }

          if (!first.done) {
            yield first.value;
            while (true) {
              const next = await iterator.next();
              if (next.done) break;
              yield next.value;
            }
          }
          return;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError;
    },
  };
}
