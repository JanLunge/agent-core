import type { EventModeHint } from '../events/index.js';
import type { BlockRef } from '../heaper/types.js';

export type NotificationTrigger =
  | 'live-response'
  | 'background-progress'
  | 'async-progress'
  | 'completed-milestone'
  | 'blocked'
  | 'failed'
  | 'approval-required';

export type NotificationAction = 'direct-response' | 'notify' | 'silent';
export type NotificationPriority = 'low' | 'normal' | 'high';

export interface NotificationPolicyInput {
  mode: EventModeHint;
  trigger: NotificationTrigger;
  summary: string;
  refs?: BlockRef[];
  audience?: 'human' | 'agent' | 'system';
}

export interface NotificationIntent {
  action: NotificationAction;
  priority: NotificationPriority;
  reason: string;
  message: string;
  refs: BlockRef[];
  audience: 'human' | 'agent' | 'system';
}

/**
 * Central policy for deciding whether a runtime event should interrupt Jan,
 * reply directly to live chat, or stay quiet.
 */
export function decideNotification(input: NotificationPolicyInput): NotificationIntent {
  const refs = dedupeRefs(input.refs ?? []);
  const audience = input.audience ?? 'human';

  if (input.mode === 'live') {
    return intent('direct-response', 'normal', 'Live chat expects an immediate direct response.', input.summary, refs, audience);
  }

  if (input.trigger === 'blocked') {
    return intent('notify', 'high', 'A blocker needs human attention before work can continue.', input.summary, refs, audience);
  }

  if (input.trigger === 'failed') {
    return intent('notify', 'high', 'A failure needs attention or triage.', input.summary, refs, audience);
  }

  if (input.trigger === 'approval-required') {
    return intent('notify', 'high', 'An explicit approval decision is required.', input.summary, refs, audience);
  }

  if (input.trigger === 'completed-milestone') {
    return intent('notify', 'normal', 'A meaningful milestone completed.', input.summary, refs, audience);
  }

  if (input.mode === 'background') {
    return intent('silent', 'low', 'Ordinary background progress should not interrupt.', input.summary, refs, audience);
  }

  if (input.mode === 'async') {
    return intent('silent', 'low', 'Ordinary async progress is recorded without notification.', input.summary, refs, audience);
  }

  return intent('silent', 'low', 'No notification rule matched.', input.summary, refs, audience);
}

function intent(
  action: NotificationAction,
  priority: NotificationPriority,
  reason: string,
  message: string,
  refs: BlockRef[],
  audience: 'human' | 'agent' | 'system',
): NotificationIntent {
  return {
    action,
    priority,
    reason,
    message: concise(message),
    refs,
    audience,
  };
}

function concise(message: string, maxLength = 240): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function dedupeRefs(refs: BlockRef[]): BlockRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.heap}#${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
