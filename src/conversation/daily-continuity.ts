import type { BlockRef, HeapName, HeaperBlock, HeaperMemory } from '../heaper/types.js';

export interface DailyContinuityEntry {
  date: string;
  blockRef: BlockRef;
  content: string;
  linkedSessionSummaries: BlockRef[];
}

export interface DailyContinuityContext {
  heap: HeapName;
  dates: string[];
  entries: DailyContinuityEntry[];
  text: string;
}

export interface ReadDailyContinuityOptions {
  memory: HeaperMemory;
  heap: HeapName;
  today?: string;
  maxEntryChars?: number;
  maxTextChars?: number;
}

const DEFAULT_MAX_ENTRY_CHARS = 1200;
const DEFAULT_MAX_TEXT_CHARS = 2400;

/**
 * Reads yesterday + today daily entries into a bounded startup context.
 *
 * Daily entries stay as Heaper blocks. The returned object only includes
 * bounded text and references to linked session summary blocks so callers can
 * fetch full session context explicitly when needed.
 */
export async function readDailyContinuity(options: ReadDailyContinuityOptions): Promise<DailyContinuityContext> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const dates = [previousDate(today), today];
  const maxEntryChars = options.maxEntryChars ?? DEFAULT_MAX_ENTRY_CHARS;
  const maxTextChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  const entries: DailyContinuityEntry[] = [];

  for (const date of dates) {
    const dailyEntry = await options.memory.getDailyEntry(date, options.heap);
    if (!dailyEntry) continue;

    entries.push({
      date,
      blockRef: refFor(dailyEntry),
      content: truncate(contentFor(dailyEntry), maxEntryChars),
      linkedSessionSummaries: await linkedSessionSummaryRefs(options.memory, dailyEntry),
    });
  }

  return {
    heap: options.heap,
    dates,
    entries,
    text: truncate(renderContinuityText(entries), maxTextChars),
  };
}

async function linkedSessionSummaryRefs(memory: HeaperMemory, dailyEntry: HeaperBlock): Promise<BlockRef[]> {
  const related = await memory.getRelatedBlocks(dailyEntry);
  return related
    .filter((block) => block.type === 'session' && block.tags.includes('session-summary'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map(refFor);
}

function renderContinuityText(entries: DailyContinuityEntry[]): string {
  return entries
    .map((entry) => {
      const refs = entry.linkedSessionSummaries.map((ref) => `${ref.heap}#${ref.id}`).join(', ');
      const suffix = refs ? `\nLinked session summaries: ${refs}` : '';
      return `## ${entry.date}\n${entry.content}${suffix}`;
    })
    .join('\n\n');
}

function contentFor(block: HeaperBlock): string {
  const content = block.data.content;
  return typeof content === 'string' ? content : '';
}

function refFor(block: HeaperBlock): BlockRef {
  return { heap: block.heap, id: block.id };
}

function previousDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Invalid date: ${date}`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}
