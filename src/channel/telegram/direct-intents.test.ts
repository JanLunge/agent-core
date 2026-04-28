import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseDirectFileDeleteIntent, parseDirectFileIntent, parseDirectFileWriteIntent } from './direct-intents.js';

describe('direct Telegram file intents', () => {
  it('detects a desktop test-note creation request', () => {
    expect(parseDirectFileWriteIntent('can you create a test-note on the desktop please')).toMatchObject({
      kind: 'file-write',
      path: join(homedir(), 'Desktop', 'test-note.md'),
      description: 'Create test-note.md on the Desktop',
    });
  });

  it('detects a desktop markdown deletion request with an explicit filename', () => {
    expect(parseDirectFileDeleteIntent('now remove the a.md again')).toMatchObject({
      kind: 'file-delete',
      path: join(homedir(), 'Desktop', 'a.md'),
      description: 'Move a.md from the Desktop to Trash',
    });
  });

  it('detects a bare desktop note deletion request', () => {
    expect(parseDirectFileDeleteIntent('delete the test-note')).toMatchObject({
      kind: 'file-delete',
      path: join(homedir(), 'Desktop', 'test-note.md'),
    });
  });

  it('prefers delete intent over write intent for remove requests', () => {
    expect(parseDirectFileIntent('remove the test-note.md from the desktop')).toMatchObject({ kind: 'file-delete' });
  });

  it('ignores non-write chatter', () => {
    expect(parseDirectFileIntent('what is on my desktop?')).toBeUndefined();
  });
});
