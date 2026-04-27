import { describe, expect, it } from 'vitest';
import { decideGuard } from './guard.js';

describe('decideGuard', () => {
  it('denies secret-like reads', () => {
    expect(decideGuard({ surface: 'file', action: 'read', target: '/app/.env' })).toMatchObject({
      disposition: 'deny',
      reason: 'Secret-like target reads are blocked by the guard.',
      audit: { surface: 'file', action: 'read', target: '/app/.env', sensitiveMode: false },
    });
  });

  it('asks for risky writes', () => {
    expect(decideGuard({ surface: 'file', action: 'write', target: '/tmp/output.md' })).toMatchObject({
      disposition: 'ask',
      reason: 'Write operation requires approval unless separately pre-approved.',
    });
  });

  it('asks for destructive shell commands with auditable details', () => {
    expect(decideGuard({ surface: 'shell', action: 'execute', target: 'shell', command: 'rm -rf dist' })).toMatchObject({
      disposition: 'ask',
      reason: 'Destructive operation requires explicit approval.',
      audit: { surface: 'shell', action: 'execute', target: 'shell', destructive: true },
    });
  });

  it('blocks external operations in sensitive mode', () => {
    expect(decideGuard({ surface: 'api', action: 'network', target: 'https://api.example.test', sensitiveMode: true })).toMatchObject({
      disposition: 'deny',
      reason: 'Sensitive mode blocks external/network operations.',
      audit: { external: true, sensitiveMode: true },
    });
  });

  it('asks for external API operations outside sensitive mode', () => {
    expect(decideGuard({ surface: 'api', action: 'network', target: 'https://api.example.test' })).toMatchObject({
      disposition: 'ask',
      reason: 'External API operation requires approval.',
    });
  });

  it('allows safe local reads and commands', () => {
    expect(decideGuard({ surface: 'file', action: 'read', target: '/tmp/notes.md' }).disposition).toBe('allow');
    expect(decideGuard({ surface: 'shell', action: 'execute', target: 'shell', command: 'pnpm typecheck' }).disposition).toBe('allow');
  });
});
