import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { executeApprovedOperation, OperationApprovalBroker, renderOperationApproval } from './approval.js';

describe('OperationApprovalBroker', () => {
  it('stores and consumes any typed pending operation by id', () => {
    const broker = new OperationApprovalBroker();
    const pending = broker.request({
      kind: 'tool.call',
      description: 'Run tool write_file',
      target: 'write_file',
      risk: 'medium',
      args: { toolName: 'write_file', toolArgs: { path: '/tmp/note.md', content: 'hello' } },
    });

    expect(renderOperationApproval(pending.operation)).toContain('Approve this tool call?');
    expect(broker.take(pending.id)).toMatchObject({ kind: 'tool.call', target: 'write_file' });
    expect(broker.take(pending.id)).toBeUndefined();
  });

  it('executes approved file writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-core-op-'));
    const path = join(dir, 'note.md');
    const result = await executeApprovedOperation({
      kind: 'file.write',
      description: 'Write a note',
      target: path,
      risk: 'medium',
      args: { path, content: 'hello' },
    });

    expect(result.ok).toBe(true);
    await expect(readFile(path, 'utf8')).resolves.toBe('hello');
  });

  it('executes approved file deletes by moving to Trash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-core-op-'));
    const path = join(dir, 'delete-me.md');
    await writeFile(path, 'bye', 'utf8');

    const result = await executeApprovedOperation({
      kind: 'file.delete',
      description: 'Delete a note',
      target: path,
      risk: 'high',
      args: { path, recoverable: true },
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('Approved and moved to Trash');
    await expect(readFile(path, 'utf8')).rejects.toThrow();
  });
});
