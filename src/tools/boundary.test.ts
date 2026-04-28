import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import { createBoundaryToolRegistry, executeBoundaryTool } from './boundary.js';
import type { ToolContext } from './registry.js';

const context: ToolContext = { agentName: 'mira', conversationId: 'c-1', baseDir: '/workspace' };

describe('boundary tool registry and execution', () => {
  it('registers tools with kind, sensitivity, and required permissions', () => {
    const registry = createBoundaryToolRegistry();
    registry.register({
      name: 'file.read',
      description: 'Read a local file',
      kind: 'file',
      sensitivity: 'sensitive-compatible',
      action: 'read',
      requiredPermissions: ['file:read'],
      target: (args) => String(args.path),
      handler: async () => 'ok',
    });

    expect(registry.get('file.read')).toMatchObject({
      name: 'file.read',
      kind: 'file',
      sensitivity: 'sensitive-compatible',
      requiredPermissions: ['file:read'],
    });
    expect(registry.list()).toHaveLength(1);
  });

  it('blocks execution when guard denies and records audit trail', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const registry = createBoundaryToolRegistry();
    let called = false;
    registry.register({
      name: 'api.fetch',
      description: 'Fetch remote API',
      kind: 'api',
      sensitivity: 'normal',
      action: 'network',
      requiredPermissions: ['network'],
      target: (args) => String(args.url),
      handler: async () => { called = true; return 'secret'; },
    });

    const result = await executeBoundaryTool({
      registry,
      memory,
      auditHeap: 'agent/audit',
      outputHeap: 'agent/tool-output',
      toolName: 'api.fetch',
      args: { url: 'https://api.example.test/private' },
      context,
      sensitiveMode: true,
      originRefs: [{ heap: 'agent/sessions', id: 's-1' }],
    });

    expect(called).toBe(false);
    expect(result.result).toMatchObject({ skipped: true, error: 'Sensitive mode blocks external/network operations.' });
    expect(result.approvalRequestRef).toBeUndefined();
    expect(result.toolIntentRef).toEqual({ heap: 'agent/audit', id: 'block-1' });
    expect(result.guardDecisionRef).toEqual({ heap: 'agent/audit', id: 'block-2' });
    await expect(memory.getBlock(result.toolIntentRef)).resolves.toMatchObject({
      tags: ['tool-intent', 'tool:api.fetch', 'kind:api'],
      links: [{ heap: 'agent/sessions', id: 's-1' }],
    });
    await expect(memory.getBlock(result.guardDecisionRef)).resolves.toMatchObject({
      tags: ['guard-decision', 'tool:api.fetch', 'disposition:deny'],
      links: [result.toolIntentRef],
    });
  });

  it('blocks execution when guard asks for approval and creates a durable approval request', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const registry = createBoundaryToolRegistry();
    let called = false;
    registry.register({
      name: 'file.write',
      description: 'Write a local file',
      kind: 'file',
      sensitivity: 'normal',
      action: 'write',
      requiredPermissions: ['file:write'],
      target: (args) => String(args.path),
      handler: async () => { called = true; return 'written'; },
    });

    const result = await executeBoundaryTool({
      registry,
      memory,
      auditHeap: 'agent/audit',
      outputHeap: 'agent/tool-output',
      approvalHeap: 'agent/approvals',
      toolName: 'file.write',
      args: { path: '/workspace/out.txt' },
      context,
      originRefs: [{ heap: 'agent/sessions', id: 'session-1' }, { heap: 'agent/tasks', id: 'task-1' }],
    });

    expect(called).toBe(false);
    expect(result.guardDecision.disposition).toBe('ask');
    expect(result.result).toMatchObject({ skipped: true, error: 'Write operation requires approval unless separately pre-approved.' });
    expect(result.approvalRequestRef).toEqual({ heap: 'agent/approvals', id: 'block-3' });
    await expect(memory.getBlock(result.approvalRequestRef!)).resolves.toMatchObject({
      type: 'proposal',
      tags: ['approval-request', 'status:pending', 'surface:file', 'action:write', 'requester:mira'],
      data: {
        status: 'pending',
        reason: 'Write operation requires approval unless separately pre-approved.',
        proposedOperation: {
          surface: 'file',
          action: 'write',
          target: '/workspace/out.txt',
          args: { path: '/workspace/out.txt' },
        },
        exactRequest: { surface: 'file', action: 'write', target: '/workspace/out.txt' },
        requester: 'mira',
      },
      links: [
        { heap: 'agent/sessions', id: 'session-1' },
        { heap: 'agent/tasks', id: 'task-1' },
        result.toolIntentRef,
        result.guardDecisionRef,
      ],
      metadata: { source: 'approval-request-model', exactOperationCaptured: true },
    });
  });

  it('executes allowed local read-only tools and stores bounded output refs', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const registry = createBoundaryToolRegistry();
    registry.register({
      name: 'file.read',
      description: 'Read a local file',
      kind: 'file',
      sensitivity: 'sensitive-compatible',
      action: 'read',
      requiredPermissions: ['file:read'],
      target: (args) => String(args.path),
      handler: async (args) => `contents of ${args.path}: ${'x'.repeat(40)}`,
    });

    const result = await executeBoundaryTool({
      registry,
      memory,
      auditHeap: 'agent/audit',
      outputHeap: 'agent/tool-output',
      toolName: 'file.read',
      args: { path: '/workspace/notes.md' },
      context,
      sensitiveMode: true,
    });

    expect(result.guardDecision.disposition).toBe('allow');
    expect(result.resultRef).toEqual({ heap: 'agent/tool-output', id: 'block-3' });
    expect(result.result.result).toContain('[full tool output stored: agent/tool-output#block-3;');
    await expect(memory.getBlock(result.resultRef!)).resolves.toMatchObject({
      type: 'tool-output',
      tags: ['tool-output', 'tool:file.read', 'tool:file.read'],
      links: [result.toolIntentRef, result.guardDecisionRef],
      data: { name: 'file.read' },
    });
  });
});
