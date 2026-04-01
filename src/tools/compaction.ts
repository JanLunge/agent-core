import type { LLMProvider } from '../llm/types.js';

const SMALL_THRESHOLD = 2 * 1024;   // 2 KB
const MEDIUM_THRESHOLD = 20 * 1024; // 20 KB
const HEAD_BYTES = 2 * 1024;        // 2 KB
const TAIL_BYTES = 1 * 1024;        // 1 KB

const SUMMARIZE_PROMPT =
  'Summarize this tool output concisely, preserving key data:';

/**
 * Compact a tool result string based on its size.
 *
 * - Small  (<2 KB):  returned as-is
 * - Medium (2–20 KB): summarised via LLM if a provider is available, otherwise truncated
 * - Large  (>20 KB): head + tail kept, with LLM summary when possible
 */
export async function compactToolResult(
  result: string,
  provider?: LLMProvider,
  model?: string,
): Promise<string> {
  const bytes = Buffer.byteLength(result, 'utf8');

  // Small — pass through
  if (bytes <= SMALL_THRESHOLD) {
    return result;
  }

  // Medium — LLM summarise or simple truncate
  if (bytes <= MEDIUM_THRESHOLD) {
    if (provider && model) {
      return summariseViaLLM(result, provider, model);
    }
    return truncateWithNote(result, MEDIUM_THRESHOLD);
  }

  // Large — head + tail, optionally with LLM summary
  const head = Buffer.from(result, 'utf8')
    .subarray(0, HEAD_BYTES)
    .toString('utf8');
  const tail = Buffer.from(result, 'utf8')
    .subarray(-TAIL_BYTES)
    .toString('utf8');

  if (provider && model) {
    const summary = await summariseViaLLM(result, provider, model);
    return `${head}\n\n[… compacted — LLM summary follows …]\n\n${summary}\n\n[… tail …]\n\n${tail}`;
  }

  return `${head}\n\n[… truncated ${Math.round(bytes / 1024)} KB result — showing first 2 KB + last 1 KB …]\n\n${tail}`;
}

async function summariseViaLLM(
  text: string,
  provider: LLMProvider,
  model: string,
): Promise<string> {
  try {
    const response = await provider.complete({
      model,
      messages: [
        { role: 'user', content: `${SUMMARIZE_PROMPT}\n\n${text}` },
      ],
      temperature: 0,
      max_tokens: 1024,
    });
    return response.content ?? text;
  } catch {
    // Fall back to truncation when LLM call fails
    return truncateWithNote(text, MEDIUM_THRESHOLD);
  }
}

function truncateWithNote(text: string, limit: number): string {
  const truncated = Buffer.from(text, 'utf8')
    .subarray(0, limit)
    .toString('utf8');
  return `${truncated}\n\n[result truncated — exceeded ${Math.round(limit / 1024)} KB display limit]`;
}
