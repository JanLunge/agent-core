import type { NormalizedEvent } from '../events/index.js';
import type { BlockRef, HeapName, HeaperBlock, HeaperMemory } from '../heaper/types.js';
import type { RoutingDecision } from './router.js';

export interface RouteRecordData extends Record<string, unknown> {
  eventId: string;
  agentName: string;
  persona?: string;
  channelId: string;
  sessionId: string;
  mode: RoutingDecision['mode'];
  sensitivity: RoutingDecision['sensitivity'];
  modelPolicyHint: RoutingDecision['modelPolicyHint'];
  respondLive: boolean;
  reason: string;
  eventSource?: NormalizedEvent['source'];
  eventSurface?: string;
  eventTags?: string[];
}

export interface StoreRouteDecisionInput {
  memory: HeaperMemory;
  heap: HeapName;
  event: NormalizedEvent;
  decision: RoutingDecision;
  eventRef: BlockRef;
  sessionRef: BlockRef;
}

export interface QueryRouteHistoryInput {
  memory: HeaperMemory;
  heap: HeapName;
  channelId?: string;
  sessionId?: string;
  persona?: string;
  sensitivity?: RoutingDecision['sensitivity'];
  limit?: number;
}

export async function storeRouteDecision(input: StoreRouteDecisionInput): Promise<HeaperBlock<RouteRecordData>> {
  const data: RouteRecordData = {
    eventId: input.decision.eventId,
    agentName: input.decision.agentName,
    persona: input.decision.persona,
    channelId: input.decision.channelId,
    sessionId: input.decision.sessionId,
    mode: input.decision.mode,
    sensitivity: input.decision.sensitivity,
    modelPolicyHint: input.decision.modelPolicyHint,
    respondLive: input.decision.respondLive,
    reason: input.decision.reason,
    eventSource: input.event.source,
    eventSurface: input.event.surface,
    eventTags: input.event.routing.tags,
  };

  return (await input.memory.createBlock({
    heap: input.heap,
    type: 'metadata',
    data,
    tags: [
      'route-record',
      `event:${input.decision.eventId}`,
      `agent:${input.decision.agentName}`,
      `channel:${input.decision.channelId}`,
      `session:${input.decision.sessionId}`,
      `mode:${input.decision.mode}`,
      `sensitivity:${input.decision.sensitivity}`,
      `reason:${input.decision.reason}`,
      ...(input.decision.persona ? [`persona:${input.decision.persona}`] : []),
    ],
    links: [input.eventRef, input.sessionRef],
    metadata: { source: 'router', bounded: true, excludesEventContent: true },
  })) as HeaperBlock<RouteRecordData>;
}

export async function queryRouteHistory(input: QueryRouteHistoryInput): Promise<Array<HeaperBlock<RouteRecordData>>> {
  const tags = ['route-record'];
  if (input.channelId) tags.push(`channel:${input.channelId}`);
  if (input.sessionId) tags.push(`session:${input.sessionId}`);
  if (input.persona) tags.push(`persona:${input.persona}`);
  if (input.sensitivity) tags.push(`sensitivity:${input.sensitivity}`);

  const records = await input.memory.search('', {
    heaps: [input.heap],
    types: ['metadata'],
    tags,
    limit: input.limit,
  });

  return (records as Array<HeaperBlock<RouteRecordData>>).sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

export async function explainRouteHistory(input: QueryRouteHistoryInput): Promise<string> {
  const records = await queryRouteHistory(input);
  if (records.length === 0) return 'No route history found.';

  return records
    .map((record) => {
      const persona = record.data.persona ? ` persona=${record.data.persona}` : '';
      return `${record.createdAt}: ${record.data.channelId} -> ${record.data.agentName}${persona} session=${record.data.sessionId} mode=${record.data.mode} sensitivity=${record.data.sensitivity} reason=${record.data.reason}`;
    })
    .join('\n');
}
