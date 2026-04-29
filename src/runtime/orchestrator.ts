import type { NormalizedEvent } from '../events/index.js';
import type { BlockRef, HeapName, HeaperBlock, HeaperMemory } from '../heaper/types.js';
import { routeModel, type AvailableModel, type ModelRoutingDecision, type ModelRoutingPolicy, type TaskComplexity } from '../llm/model-routing.js';
import { appendRuntimeDailyContinuity, readDailyContinuity } from '../conversation/daily-continuity.js';
import { HeaperSessionStore } from '../conversation/heaper-session-store.js';
import { loadPersonaConfig, personaConfigToModelDefaults, type PersonaConfig } from '../heaper/persona-config.js';
import { selectWorkingMemory, type WorkingMemoryBundle } from '../conversation/working-memory.js';
import type { Message } from '../llm/types.js';
import type { Router, RoutingDecision } from '../router/router.js';
import { storeRouteDecision } from '../router/route-history.js';
import { createNotificationOutboxBlock } from '../notifications/outbox.js';
import { decideNotification, type NotificationIntent, type NotificationTrigger } from '../notifications/policy.js';
import { createRuntimeBlockerBlock } from './blockers.js';
import { decideGuard, type GuardDecision, type GuardRequest } from '../tools/guard.js';

export interface RuntimeResponderInput {
  event: NormalizedEvent;
  route: RoutingDecision;
  workingMemory: WorkingMemoryBundle;
  model: ModelRoutingDecision;
  guardDecisions: GuardDecision[];
}

export type RuntimeResponder = (input: RuntimeResponderInput) => Promise<string> | string;

export interface RunRuntimeEventInput {
  event: NormalizedEvent;
  router: Router;
  memory: HeaperMemory;
  sessionHeap: HeapName;
  auditHeap: HeapName;
  blockerHeap?: HeapName;
  personaConfigHeap?: HeapName;
  dailyHeap?: HeapName;
  notificationOutboxHeap?: HeapName;
  modelPolicy: ModelRoutingPolicy;
  availableModels: AvailableModel[];
  complexity?: TaskComplexity;
  guardRequests?: GuardRequest[];
  history?: Message[];
  responder?: RuntimeResponder;
}

export interface RuntimeOutcome {
  eventRef: BlockRef;
  routeRef: BlockRef;
  modelDecisionRef: BlockRef;
  guardDecisionRefs: BlockRef[];
  blockerRefs: BlockRef[];
  personaConfig?: PersonaConfig;
  sessionHeap: HeapName;
  userMessageRef: BlockRef;
  assistantMessageRef: BlockRef;
  dailyContinuityRef?: BlockRef;
  notificationIntent: NotificationIntent;
  notificationOutboxRef?: BlockRef;
  workingMemory: WorkingMemoryBundle;
  reply: string;
  route: RoutingDecision;
  model: ModelRoutingDecision;
  guardDecisions: GuardDecision[];
}

export class RuntimeBlockedError extends Error {
  constructor(
    message: string,
    readonly blockerRef: BlockRef,
    readonly notificationIntent: NotificationIntent,
    readonly cause?: unknown,
    readonly notificationOutboxRef?: BlockRef,
  ) {
    super(message);
    this.name = 'RuntimeBlockedError';
  }
}

/**
 * Testable runtime orchestration skeleton.
 *
 * It stitches the early boundaries together without real LLM calls: normalize is
 * already done by callers, then this records event/route/model/guard decisions,
 * builds bounded working memory, calls a supplied responder, and persists user
 * and assistant message blocks by reference.
 */
export async function runRuntimeEvent(input: RunRuntimeEventInput): Promise<RuntimeOutcome> {
  const blockerHeap = input.blockerHeap ?? input.auditHeap;
  const eventBlock = await input.memory.createBlock({
    heap: input.auditHeap,
    type: 'metadata',
    data: { event: input.event },
    tags: ['runtime-event', `source:${input.event.source}`, `mode:${input.event.modeHint}`],
  });

  const route = input.router.planEvent(input.event);
  const personaName = route.persona ?? route.agentName;
  let personaConfig: PersonaConfig | undefined;
  try {
    personaConfig = input.personaConfigHeap
      ? await loadPersonaConfig({ persona: personaName, memory: input.memory, heap: input.personaConfigHeap })
      : undefined;
  } catch (err) {
    const blocker = await createRuntimeBlockerBlock({
      memory: input.memory,
      heap: blockerHeap,
      error: err,
      operation: `load persona config for ${personaName}`,
      originRefs: [refFor(eventBlock)],
    });
    const blocked = runtimeBlocked(input.event, blocker, [refFor(eventBlock), refFor(blocker)], err, 'blocked');
    const notificationOutbox = input.notificationOutboxHeap
      ? await createNotificationOutboxBlock({
        memory: input.memory,
        heap: input.notificationOutboxHeap,
        intent: blocked.notificationIntent,
        source: 'runtime',
        deliveryTarget: input.event.conversationKey,
        refs: [refFor(blocker)],
      })
      : undefined;
    throw new RuntimeBlockedError(blocked.message, blocked.blockerRef, blocked.notificationIntent, blocked.cause, notificationOutbox ? refFor(notificationOutbox) : undefined);
  }
  const activeSessionHeap = personaConfig?.defaultHeaps.sessions ?? input.sessionHeap;
  const sessionStore = new HeaperSessionStore({ memory: input.memory, sessionHeap: activeSessionHeap });
  const sessionBlock = await sessionStore.createOrResume({
    sessionId: route.sessionId,
    agentName: route.agentName,
    channelId: route.channelId,
  });
  const routeBlock = await storeRouteDecision({
    memory: input.memory,
    heap: input.auditHeap,
    event: input.event,
    decision: route,
    eventRef: refFor(eventBlock),
    sessionRef: refFor(sessionBlock),
  });

  const persistedHistory = await sessionStore.getRecentMessages(route.sessionId, 11);
  const history = [
    ...persistedHistory,
    ...(input.history ?? []),
    { role: 'user' as const, content: input.event.content, timestamp: input.event.receivedAt },
  ];
  const dailyContinuityContext = input.dailyHeap
    ? await readDailyContinuity({
      memory: input.memory,
      heap: input.dailyHeap,
      today: input.event.receivedAt.slice(0, 10),
    })
    : undefined;
  const workingMemory = await selectWorkingMemory({
    memory: input.memory,
    history,
    query: input.event.content,
    heaps: [activeSessionHeap, ...(personaConfig?.defaultHeaps.shared ?? []), input.auditHeap],
    continuity: dailyContinuityContext?.text ? { text: dailyContinuityContext.text } : undefined,
  });

  let model: ModelRoutingDecision;
  try {
    model = routeModel({
      taskType: input.event.routing.taskType ?? input.event.source,
      persona: personaConfig?.id ?? route.persona,
      sensitivity: route.sensitivity,
      complexity: input.complexity ?? 'medium',
      availableModels: input.availableModels,
      policy: {
        ...input.modelPolicy,
        personaDefaults: {
          ...(input.modelPolicy.personaDefaults ?? {}),
          ...(personaConfig ? personaConfigToModelDefaults(personaConfig) : {}),
        },
      },
    });
  } catch (err) {
    const blocker = await createRuntimeBlockerBlock({
      memory: input.memory,
      heap: blockerHeap,
      error: err,
      operation: 'route model for runtime event',
      sessionRef: refFor(sessionBlock),
      originRefs: [refFor(eventBlock), refFor(routeBlock)],
    });
    const blocked = runtimeBlocked(input.event, blocker, [refFor(eventBlock), refFor(routeBlock), refFor(blocker)], err, 'blocked');
    const notificationOutbox = input.notificationOutboxHeap
      ? await createNotificationOutboxBlock({
        memory: input.memory,
        heap: input.notificationOutboxHeap,
        intent: blocked.notificationIntent,
        source: 'runtime',
        deliveryTarget: input.event.conversationKey ?? route.channelId,
        refs: [refFor(blocker)],
      })
      : undefined;
    throw new RuntimeBlockedError(blocked.message, blocked.blockerRef, blocked.notificationIntent, blocked.cause, notificationOutbox ? refFor(notificationOutbox) : undefined);
  }

  const modelBlock = await input.memory.createBlock({
    heap: input.auditHeap,
    type: 'metadata',
    data: { model },
    tags: ['model-decision', `requirement:${model.requirement}`],
    links: [refFor(eventBlock), refFor(routeBlock)],
  });

  const guardDecisions = (input.guardRequests ?? []).map((request) => decideGuard({
    ...request,
    sensitiveMode: route.sensitivity === 'sensitive' || request.sensitiveMode,
  }));
  const guardBlocks: HeaperBlock[] = [];
  for (const guard of guardDecisions) {
    guardBlocks.push(await input.memory.createBlock({
      heap: input.auditHeap,
      type: 'metadata',
      data: { guard },
      tags: ['guard-decision', `disposition:${guard.disposition}`, `surface:${guard.audit.surface}`],
      links: [refFor(eventBlock), refFor(routeBlock)],
    }));
  }

  const blockerBlocks: HeaperBlock[] = [];
  for (const guard of guardDecisions.filter((decision) => decision.disposition === 'deny')) {
    blockerBlocks.push(await createRuntimeBlockerBlock({
      memory: input.memory,
      heap: blockerHeap,
      error: guard.reason,
      operation: `guard denied ${guard.request.action} ${guard.request.target}`,
      sessionRef: refFor(sessionBlock),
      originRefs: [refFor(eventBlock), refFor(routeBlock), ...guardBlocks.map(refFor)],
    }));
  }

  const userMessage = await sessionStore.appendMessage(
    route.sessionId,
    { role: 'user', content: input.event.content, timestamp: input.event.receivedAt },
    [refFor(eventBlock), refFor(routeBlock), ...blockerBlocks.map(refFor)],
  );

  let reply: string;
  try {
    reply = await (input.responder ?? defaultResponder)({ event: input.event, route, workingMemory, model, guardDecisions });
  } catch (err) {
    const blocker = await createRuntimeBlockerBlock({
      memory: input.memory,
      heap: blockerHeap,
      error: err,
      operation: 'run runtime responder',
      sessionRef: refFor(sessionBlock),
      originRefs: [refFor(eventBlock), refFor(routeBlock), refFor(modelBlock), refFor(userMessage), ...guardBlocks.map(refFor), ...blockerBlocks.map(refFor)],
    });
    const blocked = runtimeBlocked(
      input.event,
      blocker,
      [refFor(eventBlock), refFor(routeBlock), refFor(modelBlock), refFor(userMessage), refFor(blocker)],
      err,
      'failed',
    );
    const notificationOutbox = input.notificationOutboxHeap
      ? await createNotificationOutboxBlock({
        memory: input.memory,
        heap: input.notificationOutboxHeap,
        intent: blocked.notificationIntent,
        source: 'runtime',
        deliveryTarget: input.event.conversationKey ?? route.channelId,
        refs: [refFor(blocker)],
      })
      : undefined;
    throw new RuntimeBlockedError(blocked.message, blocked.blockerRef, blocked.notificationIntent, blocked.cause, notificationOutbox ? refFor(notificationOutbox) : undefined);
  }

  const assistantMessage = await sessionStore.appendMessage(
    route.sessionId,
    { role: 'assistant', content: reply },
    [refFor(userMessage), refFor(routeBlock), refFor(modelBlock), ...guardBlocks.map(refFor), ...blockerBlocks.map(refFor)],
  );
  const continuityRefs = [
    refFor(eventBlock),
    refFor(routeBlock),
    refFor(modelBlock),
    refFor(userMessage),
    refFor(assistantMessage),
    ...guardBlocks.map(refFor),
    ...blockerBlocks.map(refFor),
  ];
  const dailyContinuity = input.dailyHeap && input.event.modeHint !== 'background'
    ? await appendRuntimeDailyContinuity({
      memory: input.memory,
      heap: input.dailyHeap,
      date: input.event.receivedAt.slice(0, 10),
      mode: input.event.modeHint,
      sensitivity: route.sensitivity,
      agentName: route.agentName,
      sessionId: route.sessionId,
      channelId: route.channelId,
      reply,
      refs: continuityRefs,
    })
    : undefined;
  const notificationIntent = decideNotification({
    mode: input.event.modeHint,
    trigger: notificationTriggerFor(input.event.modeHint, guardDecisions, blockerBlocks.map(refFor)),
    summary: reply,
    refs: [
      ...continuityRefs,
      ...(dailyContinuity ? [refFor(dailyContinuity)] : []),
    ],
  });

  const notificationOutbox = input.notificationOutboxHeap
    ? await createNotificationOutboxBlock({
      memory: input.memory,
      heap: input.notificationOutboxHeap,
      intent: notificationIntent,
      source: 'runtime',
      deliveryTarget: input.event.conversationKey ?? route.channelId,
    })
    : undefined;

  return {
    eventRef: refFor(eventBlock),
    routeRef: refFor(routeBlock),
    modelDecisionRef: refFor(modelBlock),
    guardDecisionRefs: guardBlocks.map(refFor),
    blockerRefs: blockerBlocks.map(refFor),
    personaConfig,
    sessionHeap: activeSessionHeap,
    userMessageRef: refFor(userMessage),
    assistantMessageRef: refFor(assistantMessage),
    dailyContinuityRef: dailyContinuity ? refFor(dailyContinuity) : undefined,
    notificationIntent,
    notificationOutboxRef: notificationOutbox ? refFor(notificationOutbox) : undefined,
    workingMemory,
    reply,
    route,
    model,
    guardDecisions,
  };
}

function runtimeBlocked(
  event: NormalizedEvent,
  blocker: HeaperBlock,
  refs: BlockRef[],
  cause: unknown,
  trigger: Extract<NotificationTrigger, 'blocked' | 'failed'>,
): RuntimeBlockedError {
  const notificationIntent = decideNotification({
    mode: event.modeHint,
    trigger,
    summary: String(blocker.data.details ?? blocker.data.title ?? 'Runtime blocked'),
    refs,
  });
  return new RuntimeBlockedError(String(blocker.data.title ?? 'Runtime blocked'), refFor(blocker), notificationIntent, cause);
}

function notificationTriggerFor(mode: NormalizedEvent['modeHint'], guardDecisions: GuardDecision[], blockerRefs: BlockRef[] = []): NotificationTrigger {
  if (guardDecisions.some((guard) => guard.disposition === 'ask')) return 'approval-required';
  if (blockerRefs.length > 0) return 'blocked';
  if (mode === 'live') return 'live-response';
  if (mode === 'background') return 'background-progress';
  return 'async-progress';
}

function defaultResponder(input: RuntimeResponderInput): string {
  return `Prepared runtime context for ${input.route.agentName}: ${input.event.content}`;
}

function refFor(block: HeaperBlock): BlockRef {
  return { heap: block.heap, id: block.id };
}
