import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import type { PersonaModelDefaults } from '../llm/model-routing.js';
import type { HeapName, HeaperBlock, HeaperMemory } from './types.js';
import { normalizePersonaName, readableHeapsForPersona, resolvePersonaHeaps } from './persona-resolver.js';

export interface PersonaConfig extends Record<string, unknown> {
  id: string;
  name: string;
  description?: string;
  defaultHeaps: {
    memory: HeapName;
    sessions: HeapName;
    daily: HeapName;
    toolOutput: HeapName;
    tasks: HeapName;
    shared: HeapName[];
  };
  modelDefaults?: PersonaModelDefaults;
  tags: string[];
  privateConfig: boolean;
  source: 'heaper' | 'file' | 'defaults';
}

export interface LoadPersonaConfigInput {
  persona: string;
  memory?: HeaperMemory;
  heap?: HeapName;
  filePath?: string;
}

interface PersonaConfigDocument extends Record<string, unknown> {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  heaps?: unknown;
  modelDefaults?: unknown;
  tags?: unknown;
  privateConfig?: unknown;
}

export async function loadPersonaConfig(input: LoadPersonaConfigInput): Promise<PersonaConfig> {
  const persona = normalizePersonaName(input.persona);

  if (input.memory && input.heap) {
    const block = await findPersonaConfigBlock(input.memory, input.heap, persona);
    if (block) return normalizeConfig(persona, block.data, 'heaper');
  }

  if (input.filePath) {
    const raw = await readFile(input.filePath, 'utf8');
    return normalizeConfig(persona, parseConfigDocument(raw), 'file');
  }

  return defaultPersonaConfig(persona, 'defaults');
}

export function personaConfigToModelDefaults(config: PersonaConfig): Record<string, PersonaModelDefaults> {
  return config.modelDefaults ? { [config.id]: config.modelDefaults } : {};
}

export function canExposePersonaConfigToPersona(config: PersonaConfig, requesterPersona: string): boolean {
  if (!config.privateConfig) return true;
  return normalizePersonaName(requesterPersona) === config.id;
}

async function findPersonaConfigBlock(memory: HeaperMemory, heap: HeapName, persona: string): Promise<HeaperBlock | undefined> {
  const hits = await memory.search('', {
    heaps: [heap],
    types: ['metadata'],
    tags: ['persona-config', `persona:${persona}`],
    limit: 1,
  });
  return hits[0];
}

function parseConfigDocument(raw: string): PersonaConfigDocument {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as PersonaConfigDocument;

  const frontmatter = trimmed.match(/^---\n([\s\S]*?)\n---(?:\n[\s\S]*)?$/);
  return (YAML.parse(frontmatter ? frontmatter[1] : trimmed) ?? {}) as PersonaConfigDocument;
}

function normalizeConfig(persona: string, document: PersonaConfigDocument, source: PersonaConfig['source']): PersonaConfig {
  const id = normalizePersonaName(stringField(document.id, persona, 'id'));
  if (id !== persona) throw new Error(`Persona config id mismatch: expected ${persona}, got ${id}`);
  const name = stringField(document.name, id, 'name').trim();
  if (!name) throw new Error('Persona config name cannot be empty');

  return {
    id,
    name,
    description: optionalString(document.description, 'description'),
    defaultHeaps: normalizeHeaps(id, document.heaps),
    modelDefaults: normalizeModelDefaults(document.modelDefaults),
    tags: normalizeTags(document.tags),
    privateConfig: document.privateConfig === undefined ? true : booleanField(document.privateConfig, 'privateConfig'),
    source,
  };
}

function defaultPersonaConfig(persona: string, source: PersonaConfig['source']): PersonaConfig {
  return normalizeConfig(persona, { id: persona, name: persona }, source);
}

function normalizeHeaps(persona: string, value: unknown): PersonaConfig['defaultHeaps'] {
  if (value !== undefined && (!isRecord(value) || Array.isArray(value))) throw new Error('Persona config heaps must be an object');
  const heaps = resolvePersonaHeaps(persona);
  const input = (value ?? {}) as Record<string, unknown>;
  const shared = input.shared === undefined ? ['agent/shared'] : arrayOfStrings(input.shared, 'heaps.shared');

  return {
    memory: heapField(input.memory, heaps.memory, 'heaps.memory'),
    sessions: heapField(input.sessions, heaps.sessions, 'heaps.sessions'),
    daily: heapField(input.daily, heaps.daily, 'heaps.daily'),
    toolOutput: heapField(input.toolOutput, heaps.toolOutput, 'heaps.toolOutput'),
    tasks: heapField(input.tasks, heaps.tasks, 'heaps.tasks'),
    shared: shared.map((heap, index) => heapName(heap, `heaps.shared[${index}]`)),
  };
}

function normalizeModelDefaults(value: unknown): PersonaModelDefaults | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Array.isArray(value)) throw new Error('Persona config modelDefaults must be an object');
  return {
    defaultModel: optionalString(value.defaultModel, 'modelDefaults.defaultModel'),
    strongModel: optionalString(value.strongModel, 'modelDefaults.strongModel'),
    localModel: optionalString(value.localModel, 'modelDefaults.localModel'),
  };
}

function normalizeTags(value: unknown): string[] {
  if (value === undefined) return [];
  return arrayOfStrings(value, 'tags').map((tag) => normalizePersonaName(tag));
}

function heapField(value: unknown, fallback: HeapName, field: string): HeapName {
  return value === undefined ? fallback : heapName(stringField(value, fallback, field), field);
}

function heapName(value: string, field: string): HeapName {
  if (!/^(human|agent|persona)\/[a-z0-9][a-z0-9/-]*$/i.test(value)) throw new Error(`Invalid heap name in ${field}: ${value}`);
  return value.toLowerCase() as HeapName;
}

function stringField(value: unknown, fallback: string, field: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error(`Persona config ${field} must be a string`);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`Persona config ${field} must be a string`);
  return value;
}

function booleanField(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Persona config ${field} must be a boolean`);
  return value;
}

function arrayOfStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Persona config ${field} must be an array of strings`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readableHeapsForPersonaConfig(config: PersonaConfig): HeapName[] {
  return [...readableHeapsForPersona(config.id, []), ...config.defaultHeaps.shared];
}
