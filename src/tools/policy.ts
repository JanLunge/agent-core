import micromatch from 'micromatch';

export type ToolDisposition = 'auto' | 'ask' | 'deny';

export interface ToolPolicy {
  /** Get the disposition for a tool call. */
  check(toolName: string, args: Record<string, unknown>): ToolDisposition;
}

/**
 * A context-aware rule that can override the default disposition
 * based on the tool arguments.
 */
export interface ContextRule {
  /** Glob pattern to match tool names. */
  pattern: string;
  /** Condition evaluated against the tool args. */
  condition: (args: Record<string, unknown>) => boolean;
  /** Disposition to apply when pattern and condition both match. */
  disposition: ToolDisposition;
}

export interface ToolPolicyOptions {
  /** Glob patterns for tools that auto-execute without asking. */
  auto?: string[];
  /** Glob patterns for tools that require user confirmation. */
  ask?: string[];
  /** Glob patterns for tools that are always denied. */
  deny?: string[];
  /** Context-aware rules evaluated before the static lists. */
  rules?: ContextRule[];
}

/**
 * Configurable tool policy with glob matching and context-aware rules.
 *
 * Resolution order:
 * 1. Context rules (first matching rule wins)
 * 2. deny patterns
 * 3. auto patterns
 * 4. ask patterns
 * 5. Default: 'ask'
 */
export function createToolPolicy(options?: ToolPolicyOptions): ToolPolicy {
  const autoPatterns = options?.auto ?? [];
  const askPatterns = options?.ask ?? [];
  const denyPatterns = options?.deny ?? [];
  const rules = options?.rules ?? [];

  return {
    check(toolName: string, args: Record<string, unknown>): ToolDisposition {
      // 1. Context rules — first match wins
      for (const rule of rules) {
        if (
          micromatch.isMatch(toolName, rule.pattern) &&
          rule.condition(args)
        ) {
          return rule.disposition;
        }
      }

      // 2. Static lists: deny → auto → ask → default
      if (denyPatterns.length > 0 && micromatch.isMatch(toolName, denyPatterns)) {
        return 'deny';
      }
      if (autoPatterns.length > 0 && micromatch.isMatch(toolName, autoPatterns)) {
        return 'auto';
      }
      if (askPatterns.length > 0 && micromatch.isMatch(toolName, askPatterns)) {
        return 'ask';
      }

      return 'ask';
    },
  };
}
