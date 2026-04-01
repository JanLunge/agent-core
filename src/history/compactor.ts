import type { Episode } from './episodes.js';
import type { LLMProvider, Message } from '../llm/types.js';

export interface EpisodeSummary {
  episodeId: string;
  summary: string;
  keyDecisions: string[];
  openQuestions: string[];
  tokenCount: number;
}

const SUMMARY_PROMPT = `Summarize this conversation episode. Output JSON with fields: summary (string), keyDecisions (string[]), openQuestions (string[]).

Respond ONLY with valid JSON, no markdown fences or extra text.`;

/**
 * Send an episode's messages to the LLM and get a structured summary back.
 */
export async function compactEpisode(
  episode: Episode,
  provider: LLMProvider,
  model: string,
): Promise<EpisodeSummary> {
  const messagesForSummary: Message[] = [
    { role: 'system', content: SUMMARY_PROMPT },
    ...episode.messages,
    { role: 'user', content: 'Now produce the JSON summary of the above conversation episode.' },
  ];

  const response = await provider.complete({
    model,
    messages: messagesForSummary,
    temperature: 0.2,
  });

  const raw = (response.content ?? '').trim();

  // Try to parse JSON — strip markdown fences if the model added them anyway
  let parsed: { summary: string; keyDecisions: string[]; openQuestions: string[] };
  try {
    const jsonStr = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    parsed = JSON.parse(jsonStr);
  } catch {
    // Fallback: treat entire response as the summary
    parsed = {
      summary: raw,
      keyDecisions: [],
      openQuestions: [],
    };
  }

  return {
    episodeId: episode.id,
    summary: parsed.summary ?? raw,
    keyDecisions: parsed.keyDecisions ?? [],
    openQuestions: parsed.openQuestions ?? [],
    tokenCount: response.usage.totalTokens,
  };
}
