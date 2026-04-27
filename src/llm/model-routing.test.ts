import { describe, expect, it } from 'vitest';
import { routeModel, type AvailableModel, type ModelRoutingPolicy } from './model-routing.js';

const availableModels: AvailableModel[] = [
  { id: 'local/small', capabilities: ['local'] },
  { id: 'remote/default', capabilities: ['remote'] },
  { id: 'remote/strong', capabilities: ['remote', 'strong'] },
  { id: 'persona/mira-default', capabilities: ['remote'] },
];

const policy: ModelRoutingPolicy = {
  defaultModel: 'remote/default',
  strongModel: 'remote/strong',
  localModel: 'local/small',
  personaDefaults: {
    mira: { defaultModel: 'persona/mira-default', localModel: 'local/small' },
  },
};

describe('routeModel', () => {
  it('requires a local model for sensitive tasks', () => {
    expect(routeModel({
      taskType: 'chat',
      sensitivity: 'sensitive',
      complexity: 'high',
      availableModels,
      policy,
    })).toEqual({
      model: 'local/small',
      requirement: 'local-required',
      reason: 'sensitive-task-local-required',
    });
  });

  it('throws when sensitive tasks have no local-capable model available', () => {
    expect(() => routeModel({
      taskType: 'chat',
      sensitivity: 'sensitive',
      complexity: 'low',
      availableModels: availableModels.filter((model) => !model.capabilities.includes('local')),
      policy,
    })).toThrow('Sensitive task requires a local model');
  });

  it('prefers a strong model for non-sensitive complex tasks', () => {
    expect(routeModel({
      taskType: 'coding',
      sensitivity: 'normal',
      complexity: 'high',
      availableModels,
      policy,
    })).toEqual({
      model: 'remote/strong',
      requirement: 'strong-preferred',
      reason: 'high-complexity-strong-model',
    });
  });

  it('falls back to the default model when strong preference is unavailable', () => {
    expect(routeModel({
      taskType: 'coding',
      sensitivity: 'normal',
      complexity: 'high',
      availableModels: availableModels.filter((model) => !model.capabilities.includes('strong')),
      policy,
    })).toEqual({
      model: 'remote/default',
      requirement: 'default',
      reason: 'policy-default',
    });
  });

  it('respects persona defaults for normal work', () => {
    expect(routeModel({
      taskType: 'chat',
      persona: 'Mira',
      sensitivity: 'normal',
      complexity: 'medium',
      availableModels,
      policy,
    })).toEqual({
      model: 'persona/mira-default',
      requirement: 'default',
      reason: 'persona-default',
    });
  });

  it('does not let persona defaults bypass sensitive local routing', () => {
    expect(routeModel({
      taskType: 'chat',
      persona: 'Mira',
      sensitivity: 'sensitive',
      complexity: 'medium',
      availableModels,
      policy,
    }).model).toBe('local/small');
  });
});
