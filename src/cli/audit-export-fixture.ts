import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { BlockRef, HeapName } from '../heaper/types.js';
import { LocalHeaperMemory } from '../heaper/local-storage.js';
import { createRuntimeTelegramSpikeRuntime } from './runtime-telegram-spike.js';
import { exportAuditTrail } from './audit-export.js';

export interface RunTelegramAuditFixtureOptions {
  storePath?: string;
  baseDir?: string;
  maxDepth?: number;
}

export interface TelegramAuditFixtureResult {
  storePath: string;
  startRef: BlockRef;
  auditCommand: string;
  auditText: string;
  turns: Array<{ text: string; sessionId: string; eventRef: BlockRef; routeRef: BlockRef }>;
}

const FIXTURE_TURNS = [
  'remember concise morning status and run status tool',
  'what did I ask you to remember?',
  '@ops check this handoff',
  '#sensitive please call external API and write note and read .env secret',
];

/**
 * Build a deterministic Telegram-spike-like LocalHeaperMemory store, then run
 * the audit exporter from the persisted session ref. This gives local operators
 * a reproducible fixture for inspecting real runtime block relationships.
 */
export async function runTelegramAuditFixture(options: RunTelegramAuditFixtureOptions = {}): Promise<TelegramAuditFixtureResult> {
  const storePath = options.storePath ? resolve(options.storePath) : join(await mkdtemp(join(tmpdir(), 'agent-core-audit-fixture-')), 'memory.json');
  const runtime = createRuntimeTelegramSpikeRuntime({ storePath, baseDir: options.baseDir ?? dirname(storePath) });
  const turns = [];

  for (const [index, text] of FIXTURE_TURNS.entries()) {
    const turn = await runtime.handleTurn({
      chatId: '177485465',
      text,
      sender: 'Jan',
      messageId: String(index + 1),
    });
    turns.push({
      text,
      sessionId: turn.outcome.route.sessionId,
      eventRef: turn.outcome.eventRef,
      routeRef: turn.outcome.routeRef,
    });
  }

  const memory = new LocalHeaperMemory({ filePath: storePath });
  const firstSessionId = turns[0]?.sessionId;
  const startRef = await findSessionRef(memory, firstSessionId, 'agent/sessions');
  const maxDepth = options.maxDepth ?? 6;
  const auditText = await exportAuditTrail({ memory, startRef, maxDepth });

  return {
    storePath,
    startRef,
    auditCommand: `agent-core audit-export ${formatRef(startRef)} --store ${storePath} --depth ${maxDepth}`,
    auditText,
    turns,
  };
}

export function renderTelegramAuditFixture(result: TelegramAuditFixtureResult): string {
  return [
    `Fixture store: ${result.storePath}`,
    `Start ref: ${formatRef(result.startRef)}`,
    `Audit command: ${result.auditCommand}`,
    'Turns:',
    ...result.turns.map((turn, index) => `- ${index + 1}. ${turn.text} (${formatRef(turn.eventRef)}, ${formatRef(turn.routeRef)})`),
    '',
    result.auditText,
  ].join('\n');
}

async function findSessionRef(memory: LocalHeaperMemory, sessionId: string | undefined, heap: HeapName): Promise<BlockRef> {
  if (!sessionId) throw new Error('Fixture did not create a runtime session');
  const sessions = await memory.search('', { heaps: [heap], types: ['session'], limit: 50 });
  const session = sessions.find((block) => block.data.sessionId === sessionId);
  if (!session) throw new Error(`Fixture session not found in ${heap}: ${sessionId}`);
  return { heap: session.heap, id: session.id };
}

function formatRef(ref: BlockRef): string {
  return `${ref.heap}#${ref.id}`;
}
