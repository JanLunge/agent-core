import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseDirectFileWriteIntent } from './direct-intents.js';

describe('parseDirectFileWriteIntent', () => {
  it('detects a desktop test-note creation request', () => {
    expect(parseDirectFileWriteIntent('can you create a test-note on the desktop please')).toMatchObject({
      kind: 'file-write',
      path: join(homedir(), 'Desktop', 'test-note.md'),
      description: 'Create test-note.md on the Desktop',
    });
  });

  it('ignores non-write chatter', () => {
    expect(parseDirectFileWriteIntent('what is on my desktop?')).toBeUndefined();
  });
});
