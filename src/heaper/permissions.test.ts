import { describe, expect, it } from 'vitest';
import { decideHeapPermission } from './permissions.js';
import { parseHeapName } from './types.js';

const mira = { kind: 'agent' as const, name: 'Mira', persona: 'mira' };

it('parses human, agent, and persona heap names', () => {
  expect(parseHeapName('human/jan')).toEqual({
    scope: 'human',
    owner: 'jan',
    path: 'jan',
    name: 'human/jan',
  });
  expect(parseHeapName('agent/tasks')).toMatchObject({ scope: 'agent', owner: 'tasks' });
  expect(parseHeapName('persona/mira/memory')).toEqual({
    scope: 'persona',
    owner: 'mira',
    path: 'memory',
    name: 'persona/mira/memory',
  });
});

it('allows agents to work in agent and persona heaps', () => {
  expect(decideHeapPermission({ actor: mira, heap: 'agent/tasks', action: 'write' })).toBe('allow');
  expect(decideHeapPermission({ actor: mira, heap: 'persona/mira/memory', action: 'update' })).toBe('allow');
});

it('lets agents read but not silently mutate human heaps', () => {
  expect(decideHeapPermission({ actor: mira, heap: 'human/jan', action: 'read' })).toBe('allow');
  expect(decideHeapPermission({ actor: mira, heap: 'human/jan', action: 'write' })).toBe('ask');
});

it('allows human heap mutation with explicit approval or bot-editable tag', () => {
  expect(decideHeapPermission({ actor: mira, heap: 'human/jan', action: 'write', explicitApproval: true })).toBe('allow');
  expect(decideHeapPermission({ actor: mira, heap: 'human/jan', action: 'update', tags: ['bot-editable'] })).toBe('allow');
});
