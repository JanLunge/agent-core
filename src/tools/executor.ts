import type { ParsedToolCall } from '../llm/function-calling.js';
import type { ToolContext } from './registry.js';
import { ToolRegistry } from './registry.js';
import type { ToolPolicy } from './policy.js';
import type { ApprovalCallback } from './approval.js';

const MAX_RESULT_BYTES = 20 * 1024;

export interface ToolResult {
  toolCallId: string;
  name: string;
  result: string;
  error?: string;
  durationMs: number;
  skipped?: boolean;
}

export interface ExecuteOptions {
  registry: ToolRegistry;
  context: ToolContext;
  policy?: ToolPolicy;
  onApproval?: ApprovalCallback;
}

function truncate(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= MAX_RESULT_BYTES) return text;
  const truncated = Buffer.from(text, 'utf8')
    .subarray(0, MAX_RESULT_BYTES)
    .toString('utf8');
  return truncated + '\n\n[result truncated — exceeded 20KB limit]';
}

export async function executeTool(
  call: ParsedToolCall,
  options: ExecuteOptions,
): Promise<ToolResult> {
  const { registry, context, policy, onApproval } = options;
  const start = performance.now();

  if (call.parseError) {
    return { toolCallId: call.id, name: call.name, result: '', error: call.parseError, durationMs: performance.now() - start };
  }

  const entry = registry.get(call.name);
  if (!entry) {
    return { toolCallId: call.id, name: call.name, result: '', error: `Unknown tool: ${call.name}`, durationMs: performance.now() - start };
  }

  // Check policy
  const disposition = policy?.check(call.name, call.args) ?? 'ask';

  if (disposition === 'deny') {
    return { toolCallId: call.id, name: call.name, result: '', error: `Tool "${call.name}" is denied by policy.`, durationMs: performance.now() - start, skipped: true };
  }

  let finalArgs = call.args;

  if (disposition === 'ask' && onApproval) {
    const decision = await onApproval({ toolName: call.name, args: call.args });

    switch (decision.action) {
      case 'approve':
        break;
      case 'deny':
        return {
          toolCallId: call.id, name: call.name,
          result: '', error: decision.reason ?? 'User denied this tool call.',
          durationMs: performance.now() - start, skipped: true,
        };
      case 'rewrite':
        finalArgs = decision.args;
        break;
      case 'feedback':
        return {
          toolCallId: call.id, name: call.name,
          result: `User feedback: ${decision.message}`,
          durationMs: performance.now() - start, skipped: true,
        };
    }
  }

  try {
    const raw = await entry.handler(finalArgs, context);
    return { toolCallId: call.id, name: call.name, result: truncate(raw), durationMs: performance.now() - start };
  } catch (err) {
    return { toolCallId: call.id, name: call.name, result: '', error: (err as Error).message, durationMs: performance.now() - start };
  }
}

export async function executeToolCalls(
  calls: ParsedToolCall[],
  options: ExecuteOptions,
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const call of calls) {
    results.push(await executeTool(call, options));
  }
  return results;
}
