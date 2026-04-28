import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseDirectFileDeleteIntent, parseDirectOperationIntent, parseDirectFileWriteIntent } from './direct-intents.js';

describe('direct Telegram operation intents', () => {
  it('detects a desktop test-note creation request as a generic operation', () => {
    expect(parseDirectFileWriteIntent('can you create a test-note on the desktop please')).toMatchObject({
      kind: 'file.write',
      target: join(homedir(), 'Desktop', 'test-note.md'),
      args: { path: join(homedir(), 'Desktop', 'test-note.md') },
      description: 'Create test-note.md on the Desktop',
    });
  });

  it('detects a desktop markdown deletion request with an explicit filename as a generic operation', () => {
    expect(parseDirectFileDeleteIntent('now remove the a.md again')).toMatchObject({
      kind: 'file.delete',
      target: join(homedir(), 'Desktop', 'a.md'),
      args: { path: join(homedir(), 'Desktop', 'a.md'), recoverable: true },
      description: 'Move a.md from the Desktop to Trash',
    });
  });

  it('detects a bare desktop note deletion request', () => {
    expect(parseDirectFileDeleteIntent('delete the test-note')).toMatchObject({
      kind: 'file.delete',
      target: join(homedir(), 'Desktop', 'test-note.md'),
    });
  });

  it('prefers delete intent over write intent for remove requests', () => {
    expect(parseDirectOperationIntent('remove the test-note.md from the desktop')).toMatchObject({ kind: 'file.delete' });
  });

  it('uses recent file context for pronoun deletion follow-ups', () => {
    expect(parseDirectOperationIntent('remove it again', {
      lastFileTarget: join(homedir(), 'Desktop', 'a.md'),
    })).toMatchObject({
      kind: 'file.delete',
      target: join(homedir(), 'Desktop', 'a.md'),
      description: 'Move a.md from the Desktop to Trash',
    });
  });

  it('does not delete pronouns without a recent file target', () => {
    expect(parseDirectOperationIntent('remove it again')).toBeUndefined();
  });

  it('ignores non-write chatter', () => {
    expect(parseDirectOperationIntent('what is on my desktop?')).toBeUndefined();
  });
});
