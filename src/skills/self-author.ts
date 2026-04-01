import type { TraceStore, TraceEntry, ToolCallEntry } from '../journal/trace.js';
import type { LLMProvider } from '../llm/types.js';

export interface ToolSuggestion {
  name: string;
  description: string;
  reason: string;
  exampleTraceIds: number[];
}

/**
 * Scans recent traces for patterns that suggest new tools could be created:
 * - Repeated exec calls with similar commands -> suggest a dedicated tool
 * - Tool errors followed by manual workarounds -> suggest an improved tool
 */
export function reviewAndSuggestTools(
  traceStore: TraceStore,
  _skillsDir: string,
): ToolSuggestion[] {
  // Pull recent traces across all conversations (use a broad query)
  const db = traceStore.getDb();
  const rows = db
    .prepare(
      `SELECT * FROM traces ORDER BY id DESC LIMIT 200`,
    )
    .all() as Array<{
    id: number;
    conversation_id: string;
    turn_index: number;
    timestamp: string;
    input: string;
    prompt_tokens: number;
    completion_tokens: number;
    model: string;
    tool_calls: string;
    reply: string;
    duration_ms: number;
  }>;

  const traces: TraceEntry[] = rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    turnIndex: r.turn_index,
    timestamp: r.timestamp,
    input: JSON.parse(r.input),
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    model: r.model,
    toolCalls: JSON.parse(r.tool_calls) as ToolCallEntry[],
    reply: r.reply,
    durationMs: r.duration_ms,
  }));

  const suggestions: ToolSuggestion[] = [];

  // Pattern 1: Repeated exec calls with similar commands
  const execCalls = new Map<string, { count: number; traceIds: Set<number> }>();
  for (const trace of traces) {
    for (const tc of trace.toolCalls) {
      if (tc.name === 'exec' || tc.name === 'shell' || tc.name === 'run_command') {
        const cmd = String(tc.args?.command ?? tc.args?.cmd ?? '');
        // Normalize: extract the base command (first word)
        const baseCmd = cmd.split(/\s+/)[0];
        if (!baseCmd) continue;

        const entry = execCalls.get(baseCmd) ?? { count: 0, traceIds: new Set() };
        entry.count++;
        entry.traceIds.add(trace.id);
        execCalls.set(baseCmd, entry);
      }
    }
  }

  for (const [baseCmd, info] of execCalls) {
    if (info.count >= 3) {
      suggestions.push({
        name: `${baseCmd}_tool`,
        description: `Dedicated tool wrapping repeated '${baseCmd}' exec calls`,
        reason: `Found ${info.count} exec calls using '${baseCmd}' across recent traces. A dedicated tool would be safer and more discoverable.`,
        exampleTraceIds: Array.from(info.traceIds).slice(0, 5),
      });
    }
  }

  // Pattern 2: Tool errors followed by workarounds
  const errorTools = new Map<string, { errors: number; traceIds: Set<number> }>();
  for (const trace of traces) {
    for (const tc of trace.toolCalls) {
      if (tc.error) {
        const entry = errorTools.get(tc.name) ?? { errors: 0, traceIds: new Set() };
        entry.errors++;
        entry.traceIds.add(trace.id);
        errorTools.set(tc.name, entry);
      }
    }
  }

  for (const [toolName, info] of errorTools) {
    if (info.errors >= 2) {
      suggestions.push({
        name: `${toolName}_improved`,
        description: `Improved version of '${toolName}' with better error handling`,
        reason: `Tool '${toolName}' produced ${info.errors} errors in recent traces. An improved version could handle these failure modes.`,
        exampleTraceIds: Array.from(info.traceIds).slice(0, 5),
      });
    }
  }

  return suggestions;
}

/**
 * Asks the LLM to write a skill file based on a tool suggestion.
 * Returns the file content as a string (caller saves and loads it).
 */
export async function generateToolScript(
  suggestion: ToolSuggestion,
  provider: LLMProvider,
  model: string,
): Promise<string> {
  const prompt = `You are a tool-authoring assistant. Write a TypeScript skill file that exports:
- name: string
- description: string
- tools: array of { name, description, parameters, handler }

The skill should implement the following tool:

Name: ${suggestion.name}
Description: ${suggestion.description}
Reason for creation: ${suggestion.reason}

The file should be a valid ESM TypeScript module. The handler signature is:
  (args: Record<string, unknown>, context: { agentName: string; conversationId: string; baseDir: string }) => Promise<string>

Return ONLY the TypeScript file content, no markdown fences or explanation.`;

  const response = await provider.complete({
    model,
    messages: [
      { role: 'system', content: 'You write concise, correct TypeScript skill files. Output only code.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
  });

  return response.content ?? '';
}
