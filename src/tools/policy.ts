export type ToolDisposition = 'auto' | 'ask' | 'deny';

export interface ToolPolicy {
  /** Get the disposition for a tool call. */
  check(toolName: string, args: Record<string, unknown>): ToolDisposition;
}

/**
 * Configurable tool policy with three lists:
 * - auto: always execute without asking
 * - deny: never execute
 * - everything else: ask the user
 */
export function createToolPolicy(options?: {
  auto?: string[];
  deny?: string[];
}): ToolPolicy {
  const autoSet = new Set(options?.auto ?? []);
  const denySet = new Set(options?.deny ?? []);

  return {
    check(toolName: string): ToolDisposition {
      if (denySet.has(toolName)) return 'deny';
      if (autoSet.has(toolName)) return 'auto';
      return 'ask';
    },
  };
}
