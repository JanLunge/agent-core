import type { ToolCall } from './types.js';

export interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  parseError?: string;
}

export function parseToolCall(tc: ToolCall): ParsedToolCall {
  try {
    const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
    return {
      id: tc.id,
      name: tc.function.name,
      args,
    };
  } catch (err) {
    return {
      id: tc.id,
      name: tc.function.name,
      args: {},
      parseError: `Failed to parse arguments: ${(err as Error).message}`,
    };
  }
}

export function parseToolCalls(tcs: ToolCall[]): ParsedToolCall[] {
  return tcs.map(parseToolCall);
}
