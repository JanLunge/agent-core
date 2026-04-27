import {
  createBackgroundEvent,
  createChatEvent,
  type BackgroundEventInput,
  type ChatEventInput,
  type NormalizedEvent,
} from './normalized-event.js';

export interface TuiEventInput {
  sessionId: string;
  text: string;
  user?: string;
  receivedAt?: string;
  id?: string;
  metadata?: Record<string, unknown>;
}

export interface ApiEventInput {
  requestId: string;
  route: string;
  bodyText: string;
  actorId?: string;
  receivedAt?: string;
  id?: string;
  metadata?: Record<string, unknown>;
}

export interface VoiceEventInput {
  conversationId: string;
  transcript: string;
  speaker?: string;
  audioRef?: string;
  receivedAt?: string;
  id?: string;
  metadata?: Record<string, unknown>;
}

export function chatInputToEvent(input: ChatEventInput): NormalizedEvent {
  return createChatEvent(input);
}

export function backgroundInputToEvent(input: BackgroundEventInput): NormalizedEvent {
  return createBackgroundEvent(input);
}

export function tuiInputToEvent(input: TuiEventInput): NormalizedEvent {
  return createChatEvent({
    id: input.id,
    channelType: 'tui',
    chatId: input.sessionId,
    text: input.text,
    sender: input.user,
    receivedAt: input.receivedAt,
    metadata: {
      surface: 'tui',
      sessionId: input.sessionId,
      ...(input.metadata ?? {}),
    },
  });
}

export function apiInputToEvent(input: ApiEventInput): NormalizedEvent {
  const event = createChatEvent({
    id: input.id,
    channelType: 'api',
    chatId: input.requestId,
    text: input.bodyText,
    sender: input.actorId,
    receivedAt: input.receivedAt,
    metadata: {
      surface: 'api',
      requestId: input.requestId,
      route: input.route,
      ...(input.metadata ?? {}),
    },
  });

  return {
    ...event,
    source: 'api',
    surface: 'api',
  };
}

export function voiceInputToEvent(input: VoiceEventInput): NormalizedEvent {
  const event = createChatEvent({
    id: input.id,
    channelType: 'voice',
    chatId: input.conversationId,
    text: input.transcript,
    sender: input.speaker,
    receivedAt: input.receivedAt,
    metadata: {
      surface: 'voice',
      conversationId: input.conversationId,
      audioRef: input.audioRef,
      ...(input.metadata ?? {}),
    },
  });

  return {
    ...event,
    source: 'voice',
    surface: 'voice',
  };
}
