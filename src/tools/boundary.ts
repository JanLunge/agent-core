import type { BlockRef, HeapName, HeaperBlock, HeaperMemory } from '../heaper/types.js';
import type { GuardAction, GuardDecision, GuardRequest, GuardSurface } from './guard.js';
import { decideGuard } from './guard.js';
import type { ToolContext, ToolHandler } from './registry.js';
import { storeToolOutput } from './output-blocks.js';
import type { ToolResult } from './executor.js';

export type BoundaryToolKind = 'file' | 'api' | 'shell' | 'internal';
export type BoundaryToolSensitivity = 'normal' | 'sensitive-compatible';

export interface BoundaryToolDeclaration {
  name: string;
  description: string;
  kind: BoundaryToolKind;
  sensitivity: BoundaryToolSensitivity;
  action: GuardAction;
  requiredPermissions: string[];
  target: (args: Record<string, unknown>) => string;
  handler: ToolHandler;
}

export interface BoundaryToolRegistry {
  register(tool: BoundaryToolDeclaration): void;
  get(name: string): BoundaryToolDeclaration | undefined;
  list(): BoundaryToolDeclaration[];
}

export interface ExecuteBoundaryToolInput {
  registry: BoundaryToolRegistry;
  memory: HeaperMemory;
  auditHeap: HeapName;
  outputHeap: HeapName;
  toolName: string;
  args: Record<string, unknown>;
  context: ToolContext;
  sensitiveMode?: boolean;
  originRefs?: BlockRef[];
}

export interface BoundaryToolExecution {
  toolIntentRef: BlockRef;
  guardDecisionRef: BlockRef;
  resultRef?: BlockRef;
  guardDecision: GuardDecision;
  result: ToolResult;
}

export function createBoundaryToolRegistry(): BoundaryToolRegistry {
  const tools = new Map<string, BoundaryToolDeclaration>();
  return {
    register(tool: BoundaryToolDeclaration): void {
      tools.set(tool.name, tool);
    },
    get(name: string): BoundaryToolDeclaration | undefined {
      return tools.get(name);
    },
    list(): BoundaryToolDeclaration[] {
      return Array.from(tools.values());
    },
  };
}

/**
 * Executes a typed local/internal tool only after a guard decision allows it.
 * Ask/deny decisions are recorded and returned as skipped results; allowed
 * output is stored as a Heaper `tool-output` block and linked to the audit trail.
 */
export async function executeBoundaryTool(input: ExecuteBoundaryToolInput): Promise<BoundaryToolExecution> {
  const tool = input.registry.get(input.toolName);
  if (!tool) throw new Error(`Unknown boundary tool: ${input.toolName}`);

  const intentBlock = await input.memory.createBlock({
    heap: input.auditHeap,
    type: 'metadata',
    data: {
      tool: {
        name: tool.name,
        kind: tool.kind,
        sensitivity: tool.sensitivity,
        action: tool.action,
        requiredPermissions: tool.requiredPermissions,
        args: input.args,
      },
    },
    tags: ['tool-intent', `tool:${tool.name}`, `kind:${tool.kind}`],
    links: input.originRefs,
  });

  const guardRequest = guardRequestFor(tool, input.args, input.sensitiveMode ?? false);
  const guardDecision = decideGuard(guardRequest);
  const guardBlock = await input.memory.createBlock({
    heap: input.auditHeap,
    type: 'metadata',
    data: { guardDecision },
    tags: ['guard-decision', `tool:${tool.name}`, `disposition:${guardDecision.disposition}`],
    links: [refFor(intentBlock)],
  });

  if (guardDecision.disposition !== 'allow') {
    return {
      toolIntentRef: refFor(intentBlock),
      guardDecisionRef: refFor(guardBlock),
      guardDecision,
      result: {
        toolCallId: tool.name,
        name: tool.name,
        result: '',
        error: guardDecision.reason,
        durationMs: 0,
        skipped: true,
      },
    };
  }

  const start = performance.now();
  try {
    const raw = await tool.handler(input.args, input.context);
    const result: ToolResult = {
      toolCallId: tool.name,
      name: tool.name,
      result: raw,
      durationMs: performance.now() - start,
    };
    const stored = await storeToolOutput({
      memory: input.memory,
      heap: input.outputHeap,
      result,
      directBytes: 0,
      links: [refFor(intentBlock), refFor(guardBlock)],
      tags: [`tool:${tool.name}`],
    });
    return {
      toolIntentRef: refFor(intentBlock),
      guardDecisionRef: refFor(guardBlock),
      resultRef: stored.stored ? stored.blockRef : undefined,
      guardDecision,
      result: stored.result,
    };
  } catch (err) {
    return {
      toolIntentRef: refFor(intentBlock),
      guardDecisionRef: refFor(guardBlock),
      guardDecision,
      result: {
        toolCallId: tool.name,
        name: tool.name,
        result: '',
        error: (err as Error).message,
        durationMs: performance.now() - start,
      },
    };
  }
}

function guardRequestFor(tool: BoundaryToolDeclaration, args: Record<string, unknown>, sensitiveMode: boolean): GuardRequest {
  return {
    surface: surfaceFor(tool.kind),
    action: tool.action,
    target: tool.target(args),
    command: tool.kind === 'shell' ? tool.target(args) : undefined,
    sensitiveMode,
  };
}

function surfaceFor(kind: BoundaryToolKind): GuardSurface {
  if (kind === 'file') return 'file';
  if (kind === 'api') return 'api';
  if (kind === 'shell') return 'shell';
  return 'tool';
}

function refFor(block: HeaperBlock): BlockRef {
  return { heap: block.heap, id: block.id };
}
