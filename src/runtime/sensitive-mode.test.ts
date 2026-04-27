import { describe, expect, it } from 'vitest';
import { enforceSensitiveRuntime } from './sensitive-mode.js';
import type { AvailableModel, ModelRoutingPolicy } from '../llm/model-routing.js';

const availableModels: AvailableModel[] = [
  { id: 'local/small', capabilities: ['local'] },
  { id: 'remote/default', capabilities: ['remote'] },
];

const policy: ModelRoutingPolicy = {
  defaultModel: 'remote/default',
  localModel: 'local/small',
};

describe('sensitive runtime enforcement', () => {
  it('requires local model routing for sensitive work', () => {
    const decision = enforceSensitiveRuntime({
      model: {
        taskType: 'chat',
        sensitivity: 'sensitive',
        complexity: 'medium',
        availableModels,
        policy,
      },
    });

    expect(decision).toMatchObject({
      allowed: true,
      model: { model: 'local/small', requirement: 'local-required', reason: 'sensitive-task-local-required' },
      violations: [],
    });
  });

  it('reports auditable model violation when no local model is available', () => {
    const decision = enforceSensitiveRuntime({
      model: {
        taskType: 'chat',
        sensitivity: 'sensitive',
        complexity: 'low',
        availableModels: [{ id: 'remote/default', capabilities: ['remote'] }],
        policy,
      },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.model).toMatchObject({ requirement: 'local-required', reason: 'model-routing-failed' });
    expect(decision.violations).toEqual([
      { kind: 'model', reason: 'Sensitive task requires a local model, but no local-capable model is available' },
    ]);
  });

  it('denies external API tools in sensitive mode with audit details', () => {
    const decision = enforceSensitiveRuntime({
      model: {
        taskType: 'api-read',
        sensitivity: 'sensitive',
        complexity: 'medium',
        availableModels,
        policy,
      },
      guards: [
        { surface: 'api', action: 'network', target: 'https://api.example.test/private' },
      ],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.guardDecisions[0]).toMatchObject({
      disposition: 'deny',
      reason: 'Sensitive mode blocks external/network operations.',
      audit: {
        surface: 'api',
        action: 'network',
        target: 'https://api.example.test/private',
        sensitiveMode: true,
        external: true,
      },
    });
    expect(decision.violations[0]).toMatchObject({
      kind: 'tool',
      reason: 'Sensitive mode blocks external/network operations.',
    });
  });

  it('allows local read-only tools in sensitive mode', () => {
    const decision = enforceSensitiveRuntime({
      model: {
        taskType: 'local-read',
        sensitivity: 'sensitive',
        complexity: 'low',
        availableModels,
        policy,
      },
      guards: [
        { surface: 'file', action: 'read', target: '/workspace/notes.md' },
        { surface: 'shell', action: 'execute', target: 'shell', command: 'pnpm typecheck' },
      ],
    });

    expect(decision.allowed).toBe(true);
    expect(decision.guardDecisions.map((guard) => guard.disposition)).toEqual(['allow', 'allow']);
    expect(decision.violations).toEqual([]);
  });

  it('keeps normal non-sensitive runtime on default model and asks for external API approval', () => {
    const decision = enforceSensitiveRuntime({
      model: {
        taskType: 'web-check',
        sensitivity: 'normal',
        complexity: 'low',
        availableModels,
        policy,
      },
      guards: [
        { surface: 'api', action: 'network', target: 'https://api.example.test/status' },
      ],
    });

    expect(decision.model).toMatchObject({ model: 'remote/default', requirement: 'default' });
    expect(decision.allowed).toBe(true);
    expect(decision.guardDecisions[0]).toMatchObject({ disposition: 'ask', reason: 'External API operation requires approval.' });
  });
});
