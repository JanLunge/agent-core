import { describe, expect, it } from 'vitest';
import {
  canReadBlockForPersona,
  normalizePersonaName,
  readableHeapsForPersona,
  resolvePersonaHeaps,
  resolveSharedAgentHeap,
  resolveWorkHeap,
} from './persona-resolver.js';

describe('persona heap resolver', () => {
  it('normalizes persona names deterministically', () => {
    expect(normalizePersonaName(' Mira ')).toBe('mira');
    expect(normalizePersonaName('Research Persona')).toBe('research-persona');
    expect(() => normalizePersonaName(' !!! ')).toThrow('Persona name cannot be empty');
  });

  it('resolves Mira to persona-private default heaps', () => {
    expect(resolvePersonaHeaps('Mira')).toEqual({
      persona: 'mira',
      memory: 'persona/mira/memory',
      sessions: 'persona/mira/sessions',
      daily: 'persona/mira/daily',
      toolOutput: 'persona/mira/tool-output',
      tasks: 'persona/mira/tasks',
    });
  });

  it('resolves shared system work to agent heaps', () => {
    expect(resolveSharedAgentHeap('tasks')).toBe('agent/tasks');
    expect(resolveWorkHeap({ scope: 'shared-agent', persona: 'mira', path: 'System Work' })).toBe('agent/system-work');
    expect(resolveWorkHeap({ path: 'daily' })).toBe('agent/daily');
  });

  it('resolves persona-scoped work to persona heaps', () => {
    expect(resolveWorkHeap({ scope: 'persona', persona: 'Mira', path: 'session summaries' })).toBe(
      'persona/mira/session-summaries',
    );
  });

  it('keeps another persona from reading Mira-private blocks by default', () => {
    expect(canReadBlockForPersona({
      persona: 'researcher',
      ref: { heap: 'persona/mira/memory', id: 'secret-1' },
    })).toBe(false);
  });

  it('allows own persona heaps and shared agent heaps', () => {
    expect(canReadBlockForPersona({ persona: 'Mira', ref: { heap: 'persona/mira/memory', id: 'm-1' } })).toBe(true);
    expect(canReadBlockForPersona({ persona: 'researcher', ref: { heap: 'agent/shared', id: 'a-1' } })).toBe(true);
  });

  it('allows another persona private block only when linked or explicitly shared', () => {
    const miraRef = { heap: 'persona/mira/memory' as const, id: 'm-1' };

    expect(canReadBlockForPersona({ persona: 'researcher', ref: miraRef, linkedRefs: [miraRef] })).toBe(true);
    expect(canReadBlockForPersona({ persona: 'researcher', ref: miraRef, tags: ['persona-shared'] })).toBe(true);
  });

  it('returns readable heaps without including other personas', () => {
    expect(readableHeapsForPersona('Mira', ['shared', 'workflows'])).toEqual([
      'persona/mira/memory',
      'persona/mira/sessions',
      'persona/mira/daily',
      'persona/mira/tool-output',
      'persona/mira/tasks',
      'agent/shared',
      'agent/workflows',
    ]);
  });
});
