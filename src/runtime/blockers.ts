import type { BlockRef, HeapName, HeaperBlock, HeaperMemory } from '../heaper/types.js';

export type RuntimeBlockerKind =
  | 'missing-credentials'
  | 'denied-permission'
  | 'test-failure'
  | 'tool-failure'
  | 'feedback-checkpoint';

export type RuntimeBlockerSeverity = 'low' | 'medium' | 'high';
export type RuntimeBlockerStatus = 'active' | 'resolved';

export interface RuntimeBlockerData extends Record<string, unknown> {
  kind: RuntimeBlockerKind;
  status: RuntimeBlockerStatus;
  severity: RuntimeBlockerSeverity;
  title: string;
  details: string;
  nextAction: string;
  operation?: string;
  createdForSession?: BlockRef;
  createdForTask?: BlockRef;
  resolvedAt?: string;
  resolution?: string;
}

export interface ClassifyRuntimeBlockerInput {
  error: unknown;
  operation?: string;
  nextAction?: string;
  sessionRef?: BlockRef;
  taskRef?: BlockRef;
  originRefs?: BlockRef[];
}

export interface CreateRuntimeBlockerInput extends ClassifyRuntimeBlockerInput {
  memory: HeaperMemory;
  heap: HeapName;
}

export interface ResolveRuntimeBlockerInput {
  memory: HeaperMemory;
  blockerRef: BlockRef;
  resolution: string;
  now?: string;
}

export interface RuntimeBlockerSummary {
  kind: RuntimeBlockerKind;
  title: string;
  nextAction: string;
  ref?: BlockRef;
}

export function classifyRuntimeBlocker(input: ClassifyRuntimeBlockerInput): RuntimeBlockerData {
  const raw = errorText(input.error);
  const operation = input.operation;
  const kind = inferKind(raw, operation);
  const details = redactSensitiveDetails(raw);

  return {
    kind,
    status: 'active',
    severity: severityFor(kind),
    title: titleFor(kind),
    details,
    nextAction: input.nextAction ?? nextActionFor(kind),
    operation,
    createdForSession: input.sessionRef,
    createdForTask: input.taskRef,
  };
}

export async function createRuntimeBlockerBlock(input: CreateRuntimeBlockerInput): Promise<HeaperBlock<RuntimeBlockerData>> {
  const data = classifyRuntimeBlocker(input);
  const links = dedupeRefs([input.sessionRef, input.taskRef, ...(input.originRefs ?? [])].filter((ref): ref is BlockRef => Boolean(ref)));

  return (await input.memory.createBlock({
    heap: input.heap,
    type: 'metadata',
    data,
    tags: [
      'runtime-blocker',
      'status:active',
      `blocker-kind:${data.kind}`,
      `severity:${data.severity}`,
      ...(input.sessionRef ? [`session:${input.sessionRef.id}`] : []),
      ...(input.taskRef ? [`task:${input.taskRef.id}`] : []),
    ],
    links,
    metadata: { source: 'runtime-blocker-taxonomy', redacted: true },
  })) as HeaperBlock<RuntimeBlockerData>;
}

export async function resolveRuntimeBlocker(input: ResolveRuntimeBlockerInput): Promise<HeaperBlock<RuntimeBlockerData>> {
  const existing = await input.memory.getBlock(input.blockerRef);
  if (!existing) throw new Error(`Runtime blocker not found: ${input.blockerRef.heap}#${input.blockerRef.id}`);
  if (existing.type !== 'metadata' || !existing.tags.includes('runtime-blocker')) {
    throw new Error(`Block is not a runtime blocker: ${input.blockerRef.heap}#${input.blockerRef.id}`);
  }

  return (await input.memory.updateBlock(input.blockerRef, {
    data: {
      status: 'resolved',
      resolvedAt: input.now ?? new Date().toISOString(),
      resolution: redactSensitiveDetails(input.resolution),
    },
    tags: [...existing.tags.filter((tag) => !tag.startsWith('status:')), 'status:resolved'],
  })) as HeaperBlock<RuntimeBlockerData>;
}

export function summarizeRuntimeBlocker(blocker: RuntimeBlockerData, ref?: BlockRef): RuntimeBlockerSummary {
  return {
    kind: blocker.kind,
    title: blocker.title,
    nextAction: blocker.nextAction,
    ref,
  };
}

export function redactSensitiveDetails(value: string): string {
  return value
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key|token|password|secret)(\s*[:=]\s*)\S+/gi, '$1$2[REDACTED]')
    .replace(/\b(sk-[a-z0-9]{8,}|gh[pousr]_[a-z0-9_]{8,}|xox[baprs]-[a-z0-9-]{8,})\b/gi, '[REDACTED]');
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  return JSON.stringify(error);
}

function inferKind(text: string, operation?: string): RuntimeBlockerKind {
  const normalized = `${operation ?? ''} ${text}`.toLowerCase();
  if (/feedback checkpoint|needs feedback|review checkpoint/.test(normalized)) return 'feedback-checkpoint';
  if (/missing credential|no credential|missing auth|unauthorized|401|api key|oauth|token/.test(normalized)) return 'missing-credentials';
  if (/permission denied|forbidden|denied by guard|guard denied|403|not allowed/.test(normalized)) return 'denied-permission';
  if (/\b(test|vitest|jest|typecheck|tsc|lint)\b/.test(normalized) && /(fail|error|non-zero|exited)/.test(normalized)) return 'test-failure';
  return 'tool-failure';
}

function severityFor(kind: RuntimeBlockerKind): RuntimeBlockerSeverity {
  if (kind === 'feedback-checkpoint') return 'medium';
  if (kind === 'test-failure') return 'medium';
  return 'high';
}

function titleFor(kind: RuntimeBlockerKind): string {
  switch (kind) {
    case 'missing-credentials':
      return 'Missing credentials';
    case 'denied-permission':
      return 'Permission denied';
    case 'test-failure':
      return 'Verification failed';
    case 'feedback-checkpoint':
      return 'Feedback checkpoint';
    case 'tool-failure':
      return 'Tool failure';
  }
}

function dedupeRefs(refs: BlockRef[]): BlockRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.heap}#${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nextActionFor(kind: RuntimeBlockerKind): string {
  switch (kind) {
    case 'missing-credentials':
      return 'Ask Jan to restore or approve the required credential path.';
    case 'denied-permission':
      return 'Ask Jan for approval or choose a safer permitted operation.';
    case 'test-failure':
      return 'Inspect failing output, fix the concrete failure, then rerun verification.';
    case 'feedback-checkpoint':
      return 'Pause and ask Jan for the requested feedback or decision.';
    case 'tool-failure':
      return 'Capture the failed operation, retry safely if appropriate, or mark the task blocked.';
  }
}
