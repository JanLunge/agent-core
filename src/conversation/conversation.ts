import { randomUUID } from 'node:crypto';
import type { Message } from '../llm/types.js';
import type { ConversationStore } from './persistence.js';

export type ConversationStatus = 'active' | 'paused' | 'ended';

export interface Conversation {
  readonly id: string;
  readonly agentName: string;
  readonly channelId: string;
  status: ConversationStatus;
  focus: string | undefined;
  addMessage(message: Message): void;
  getHistory(limit?: number): Message[];
  setFocus(focus: string): void;
  pause(): void;
  resume(): void;
  end(): void;
}

/**
 * Finds an existing active conversation for the agent/channel pair,
 * or creates a new one.
 */
export function createConversation(
  agentName: string,
  channelId: string,
  store: ConversationStore,
): Conversation {
  const existing = store.findActiveConversation(agentName, channelId);
  if (existing) {
    return buildConversation(
      existing.id,
      agentName,
      channelId,
      existing.status as ConversationStatus,
      existing.focus ?? undefined,
      store,
    );
  }

  const id = randomUUID();
  store.createConversation(id, agentName, channelId);
  return buildConversation(id, agentName, channelId, 'active', undefined, store);
}

/**
 * Loads an existing conversation from the database by ID.
 * Throws if the conversation does not exist.
 */
export function loadConversation(
  id: string,
  store: ConversationStore,
): Conversation {
  const row = store.getConversation(id);
  if (!row) {
    throw new Error(`Conversation not found: ${id}`);
  }

  return buildConversation(
    row.id,
    row.agent_name,
    row.channel_id,
    row.status as ConversationStatus,
    row.focus ?? undefined,
    store,
  );
}

function buildConversation(
  id: string,
  agentName: string,
  channelId: string,
  initialStatus: ConversationStatus,
  initialFocus: string | undefined,
  store: ConversationStore,
): Conversation {
  let status = initialStatus;
  let focus = initialFocus;

  return {
    get id() { return id; },
    get agentName() { return agentName; },
    get channelId() { return channelId; },
    get status() { return status; },
    set status(v) { status = v; },
    get focus() { return focus; },
    set focus(v) { focus = v; },

    addMessage(message: Message): void {
      store.appendMessage(id, message);
    },

    getHistory(limit?: number): Message[] {
      return store.getMessages(id, limit);
    },

    setFocus(newFocus: string): void {
      focus = newFocus;
      store.updateFocus(id, newFocus);
    },

    pause(): void {
      status = 'paused';
      store.updateStatus(id, 'paused');
    },

    resume(): void {
      status = 'active';
      store.updateStatus(id, 'active');
    },

    end(): void {
      status = 'ended';
      store.updateStatus(id, 'ended');
    },
  };
}
