import type { NormalizedEvent } from '../events/index.js';
import type { BlockRef, HeapName, HeaperBlock, HeaperMemory } from '../heaper/types.js';
import { routeModel, type AvailableModel, type ModelRoutingDecision, type ModelRoutingPolicy, type TaskComplexity } from '../llm/model-routing.js';
import { HeaperSessionStore } from '../conversation/heaper-session-store.js';
import { selectWorkingMemory, type WorkingMemoryBundle } from '../conversation/working-memory.js';
import type { Message } from '../llm/types.js';
import type { Router, RoutingDecision } from '../router/router.js';
import { storeRouteDecision } from '../router/route-history.js';
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
  userMessageRef: BlockRef;
  assistantMessageRef: BlockRef;
  workingMemory: WorkingMemoryBundle;
  reply: string;
  route: RoutingDecision;
  model: ModelRoutingDecision;
  guardDecisions: GuardDecision[];
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
  const eventBlock = await input.memory.createBlock({
    heap: input.auditHeap,
    type: 'metadata',
    data: { event: input.event },
    tags: ['runtime-event', `source:${input.event.source}`, `mode:${input.event.modeHint}`],
  });

  const route = input.router.planEvent(input.event);
  const sessionStore = new HeaperSessionStore({ memory: input.memory, sessionHeap: input.sessionHeap });
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
  const workingMemory = await selectWorkingMemory({
    memory: input.memory,
    history,
    query: input.event.content,
    heaps: [input.sessionHeap, input.auditHeap],
  });

  const model = routeModel({
    taskType: input.event.routing.taskType ?? input.event.source,
    persona: route.persona,
    sensitivity: route.sensitivity,
    complexity: input.complexity ?? 'medium',
    availableModels: input.availableModels,
    policy: input.modelPolicy,
  });
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

  const userMessage = await sessionStore.appendMessage(
    route.sessionId,
    { role: 'user', content: input.event.content, timestamp: input.event.receivedAt },
    [refFor(eventBlock), refFor(routeBlock)],
  );

  const reply = await (input.responder ?? defaultResponder)({ event: input.event, route, workingMemory, model, guardDecisions });
  const assistantMessage = await sessionStore.appendMessage(
    route.sessionId,
    { role: 'assistant', content: reply },
    [refFor(userMessage), refFor(routeBlock), refFor(modelBlock), ...guardBlocks.map(refFor)],
  );

  return {
    eventRef: refFor(eventBlock),
    routeRef: refFor(routeBlock),
    modelDecisionRef: refFor(modelBlock),
    guardDecisionRefs: guardBlocks.map(refFor),
    userMessageRef: refFor(userMessage),
    assistantMessageRef: refFor(assistantMessage),
    workingMemory,
    reply,
    route,
    model,
    guardDecisions,
  };
}

function defaultResponder(input: RuntimeResponderInput): string {
  return `Prepared runtime context for ${input.route.agentName}: ${input.event.content}`;
}

function refFor(block: HeaperBlock): BlockRef {
  return { heap: block.heap, id: block.id };
}
