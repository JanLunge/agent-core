import { randomUUID } from 'node:crypto';

export type EventSource = 'chat' | 'tui' | 'voice' | 'api' | 'background';
export type EventModeHint = 'live' | 'async' | 'background';
export type EventSensitivity = 'normal' | 'sensitive';

export interface EventActor {
  id?: string;
  displayName?: string;
  kind: 'human' | 'agent' | 'system';
}

export interface NormalizedEvent {
  id: string;
  source: EventSource;
  surface: string;
  receivedAt: string;
  actor: EventActor;
  conversationKey?: string;
  content: string;
  modeHint: EventModeHint;
  sensitivity: EventSensitivity;
  personaHint?: string;
  routing: RoutingMetadata;
  surfaceMetadata: Record<string, unknown>;
}

export interface RoutingMetadata {
  channelId?: string;
  taskType?: string;
  explicitPersona: boolean;
  explicitMode: boolean;
  explicitSensitivity: boolean;
  tags: string[];
}

export interface ChatEventInput {
  channelType: string;
  chatId: string;
  text: string;
  sender?: string;
  receivedAt?: string;
  id?: string;
  metadata?: Record<string, unknown>;
}

export interface BackgroundEventInput {
  taskId: string;
  content: string;
  taskType?: string;
  persona?: string;
  sensitive?: boolean;
  receivedAt?: string;
  id?: string;
  metadata?: Record<string, unknown>;
}

export function createChatEvent(input: ChatEventInput): NormalizedEvent {
  const hints = extractRoutingHints(input.text);
  const channelId = `${input.channelType}:${input.chatId}`;

  return {
    id: input.id ?? randomUUID(),
    source: 'chat',
    surface: input.channelType,
    receivedAt: input.receivedAt ?? new Date().toISOString(),
    actor: { kind: 'human', id: input.sender, displayName: input.sender },
    conversationKey: channelId,
    content: input.text,
    modeHint: hints.modeHint ?? 'live',
    sensitivity: hints.sensitive ? 'sensitive' : 'normal',
    personaHint: hints.persona,
    routing: {
      channelId,
      explicitPersona: Boolean(hints.persona),
      explicitMode: Boolean(hints.modeHint),
      explicitSensitivity: hints.sensitive,
      tags: hints.tags,
    },
    surfaceMetadata: input.metadata ?? {},
  };
}

export function createBackgroundEvent(input: BackgroundEventInput): NormalizedEvent {
  const hints = extractRoutingHints(input.content);

  return {
    id: input.id ?? randomUUID(),
    source: 'background',
    surface: 'background',
    receivedAt: input.receivedAt ?? new Date().toISOString(),
    actor: { kind: 'system', id: 'background-worker', displayName: 'Background worker' },
    conversationKey: `background:${input.taskId}`,
    content: input.content,
    modeHint: hints.modeHint ?? 'background',
    sensitivity: input.sensitive || hints.sensitive ? 'sensitive' : 'normal',
    personaHint: input.persona ?? hints.persona,
    routing: {
      taskType: input.taskType,
      explicitPersona: Boolean(input.persona ?? hints.persona),
      explicitMode: Boolean(hints.modeHint),
      explicitSensitivity: Boolean(input.sensitive || hints.sensitive),
      tags: hints.tags,
    },
    surfaceMetadata: input.metadata ?? {},
  };
}

export interface ExtractedRoutingHints {
  persona?: string;
  modeHint?: EventModeHint;
  sensitive: boolean;
  tags: string[];
}

export function extractRoutingHints(content: string): ExtractedRoutingHints {
  const tags = Array.from(content.matchAll(/(^|\s)#([a-z][a-z0-9_-]*)/gi), (match) => match[2].toLowerCase());
  const persona = extractPersona(content, tags);
  const modeHint = extractMode(content, tags);
  const sensitive = /(^|\s)(#sensitive|#private|\[sensitive\]|sensitive:)/i.test(content);

  return { persona, modeHint, sensitive, tags };
}

function extractPersona(content: string, tags: string[]): string | undefined {
  const bracket = content.match(/\[(?:persona|agent):\s*([a-z][a-z0-9_-]*)\]/i)?.[1];
  if (bracket) return normalizeName(bracket);

  const slash = content.match(/^\s*\/(?:persona|agent)\s+([a-z][a-z0-9_-]*)\b/i)?.[1];
  if (slash) return normalizeName(slash);

  const mention = content.match(/(^|\s)@([a-z][a-z0-9_-]*)\b/i)?.[2];
  if (mention) return normalizeName(mention);

  const personaTag = tags.find((tag) => tag.startsWith('persona-'));
  if (personaTag) return normalizeName(personaTag.slice('persona-'.length));

  return undefined;
}

function extractMode(content: string, tags: string[]): EventModeHint | undefined {
  const bracket = content.match(/\[mode:\s*(live|async|background)\]/i)?.[1] as EventModeHint | undefined;
  if (bracket) return bracket.toLowerCase() as EventModeHint;

  if (tags.includes('background')) return 'background';
  if (tags.includes('async')) return 'async';
  if (tags.includes('live')) return 'live';

  return undefined;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
