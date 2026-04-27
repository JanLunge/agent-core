import { parseHeapName, type BlockRef, type HeapName } from './types.js';

export interface PersonaHeapSet {
  persona: string;
  memory: HeapName;
  sessions: HeapName;
  daily: HeapName;
  toolOutput: HeapName;
  tasks: HeapName;
}

export interface ResolveWorkHeapOptions {
  persona?: string;
  scope?: 'persona' | 'shared-agent';
  path: string;
}

export interface PersonaReadAccessInput {
  persona: string;
  ref: BlockRef;
  tags?: string[];
  linkedRefs?: BlockRef[];
}

/**
 * Normalizes persona names for heap paths. This deliberately keeps the rule
 * boring and deterministic until persona product semantics are designed.
 */
export function normalizePersonaName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!normalized) throw new Error('Persona name cannot be empty');
  return normalized;
}

export function resolvePersonaHeaps(persona: string): PersonaHeapSet {
  const name = normalizePersonaName(persona);
  return {
    persona: name,
    memory: `persona/${name}/memory`,
    sessions: `persona/${name}/sessions`,
    daily: `persona/${name}/daily`,
    toolOutput: `persona/${name}/tool-output`,
    tasks: `persona/${name}/tasks`,
  };
}

export function resolveSharedAgentHeap(path: string): HeapName {
  return `agent/${normalizeHeapPath(path)}`;
}

export function resolveWorkHeap(options: ResolveWorkHeapOptions): HeapName {
  if (options.scope === 'shared-agent' || !options.persona) {
    return resolveSharedAgentHeap(options.path);
  }
  return `persona/${normalizePersonaName(options.persona)}/${normalizeHeapPath(options.path)}`;
}

/**
 * Persona-private heaps are isolated by default. A persona may read:
 * - shared `agent/*` heaps;
 * - its own `persona/<name>/*` heaps;
 * - another persona's block only when the exact block was explicitly linked;
 * - blocks tagged `shared` or `persona-shared`.
 */
export function canReadBlockForPersona(input: PersonaReadAccessInput): boolean {
  const heap = parseHeapName(input.ref.heap);
  const persona = normalizePersonaName(input.persona);

  if (heap.scope === 'agent') return true;
  if (heap.scope === 'human') return false;
  if (heap.scope === 'persona' && heap.owner === persona) return true;
  if (input.tags?.some((tag) => tag === 'shared' || tag === 'persona-shared')) return true;
  if (input.linkedRefs?.some((ref) => sameRef(ref, input.ref))) return true;

  return false;
}

export function readableHeapsForPersona(persona: string, sharedAgentPaths: string[] = ['shared']): HeapName[] {
  const heaps = resolvePersonaHeaps(persona);
  return [heaps.memory, heaps.sessions, heaps.daily, heaps.toolOutput, heaps.tasks, ...sharedAgentPaths.map(resolveSharedAgentHeap)];
}

function normalizeHeapPath(path: string): string {
  const normalized = path.trim().toLowerCase().split('/').filter(Boolean).map((part) => (
    part.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  )).filter(Boolean).join('/');
  if (!normalized) throw new Error('Heap path cannot be empty');
  return normalized;
}

function sameRef(a: BlockRef, b: BlockRef): boolean {
  return a.heap === b.heap && a.id === b.id;
}
