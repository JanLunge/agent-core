import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveOpenClawAuthToken } from './openclaw-auth.js';

function writeStore(homeDir: string, profiles: Record<string, unknown>) {
  const dir = join(homeDir, '.openclaw', 'agents', 'main', 'agent');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'auth-profiles.json'), JSON.stringify({ version: 1, profiles }, null, 2));
}

describe('OpenClaw auth profile resolver', () => {
  it('reads the openai-codex default OAuth access token without copying it', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'agent-core-openclaw-auth-'));
    writeStore(homeDir, {
      'openai-codex:default': {
        type: 'oauth',
        provider: 'openai-codex',
        access: 'access-token',
        refresh: 'refresh-token',
        expires: 4_000,
      },
    });

    expect(resolveOpenClawAuthToken({
      provider: 'openai-codex',
      homeDir,
      now: 1_000,
    })).toBe('access-token');
  });

  it('skips an expired default profile and chooses another unexpired provider profile', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'agent-core-openclaw-auth-'));
    writeStore(homeDir, {
      'openai-codex:default': {
        type: 'oauth',
        provider: 'openai-codex',
        access: 'expired-default',
        expires: 1_000,
      },
      'openai-codex:jan': {
        type: 'oauth',
        provider: 'openai-codex',
        access: 'fresh-token',
        expires: 4_000,
      },
    });

    expect(resolveOpenClawAuthToken({
      provider: 'openai-codex',
      homeDir,
      now: 2_000,
    })).toBe('fresh-token');
  });

  it('fails closed for expired OAuth profiles', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'agent-core-openclaw-auth-'));
    writeStore(homeDir, {
      'openai-codex:default': {
        type: 'oauth',
        provider: 'openai-codex',
        access: 'expired-token',
        expires: 1_000,
      },
    });

    expect(resolveOpenClawAuthToken({
      provider: 'openai-codex',
      homeDir,
      now: 4_000,
    })).toBeUndefined();
  });
});
