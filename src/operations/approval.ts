import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type OperationKind = 'file.write' | 'file.delete';

export interface OperationIntentBase {
  id?: string;
  kind: OperationKind;
  description: string;
  target: string;
  args: Record<string, unknown>;
  risk: 'low' | 'medium' | 'high';
}

export interface FileWriteOperation extends OperationIntentBase {
  kind: 'file.write';
  args: { path: string; content: string };
}

export interface FileDeleteOperation extends OperationIntentBase {
  kind: 'file.delete';
  args: { path: string; recoverable: true };
}

export type OperationIntent = FileWriteOperation | FileDeleteOperation;

export interface OperationExecutionResult {
  ok: boolean;
  message: string;
}

export interface PendingOperationApproval {
  id: string;
  operation: OperationIntent;
}

export class OperationApprovalBroker {
  private readonly pending = new Map<string, OperationIntent>();

  request(operation: OperationIntent): PendingOperationApproval {
    const id = operation.id ?? randomUUID();
    const pendingOperation = { ...operation, id } as OperationIntent;
    this.pending.set(id, pendingOperation);
    return { id, operation: pendingOperation };
  }

  take(id: string): OperationIntent | undefined {
    const operation = this.pending.get(id);
    if (operation) this.pending.delete(id);
    return operation;
  }
}

export async function executeApprovedOperation(operation: OperationIntent): Promise<OperationExecutionResult> {
  switch (operation.kind) {
    case 'file.write':
      return executeFileWrite(operation.args.path, operation.args.content);
    case 'file.delete':
      return executeFileDelete(operation.args.path);
  }
}

export function renderOperationApproval(operation: OperationIntent): string {
  return [
    'Permission needed:',
    operation.description,
    operation.target,
    '',
    `Approve this ${humanOperationKind(operation.kind)}?`,
  ].join('\n');
}

export function humanOperationKind(kind: OperationKind): string {
  if (kind === 'file.write') return 'file write';
  if (kind === 'file.delete') return 'file delete';
  return kind;
}

async function executeFileWrite(path: string, content: string): Promise<OperationExecutionResult> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  return { ok: true, message: `Approved and created:\n${path}` };
}

async function executeFileDelete(path: string): Promise<OperationExecutionResult> {
  const trashDir = join(homedir(), '.Trash');
  await mkdir(trashDir, { recursive: true });
  const destination = join(trashDir, uniqueTrashName(basename(path)));
  await rename(path, destination);
  return { ok: true, message: `Approved and moved to Trash:\n${path}\n→ ${destination}` };
}

function uniqueTrashName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  return `${base}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}${ext}`;
}
