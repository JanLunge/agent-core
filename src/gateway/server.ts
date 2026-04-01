import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { EventEmitter } from 'node:events';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { Router } from '../router/router.js';
import type { TraceStore, TraceEntry } from '../journal/trace.js';
import type { MemoryStore } from '../memory/store.js';
import type { ConversationStore } from '../conversation/persistence.js';
import type { StreamChunk } from '../llm/types.js';
import type { ApprovalResult } from '../tools/approval.js';
import { parseCommand } from '../commands/parser.js';
import { handleBuiltin } from '../commands/builtins.js';
import type { ClientMessage, ServerMessage } from './chat-protocol.js';
interface WsLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

export interface GatewayOptions {
  port?: number;
  host?: string;
  router: Router;
  traceStore: TraceStore;
  memoryStore: MemoryStore;
  conversationStore: ConversationStore;
}

export interface Gateway {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Emit a trace event to all connected WebSocket clients */
  broadcastTrace(trace: TraceEntry): void;
}

export function createGateway(options: GatewayOptions): Gateway {
  const {
    port = 3120,
    host = '0.0.0.0',
    router,
    traceStore,
    memoryStore,
    conversationStore,
  } = options;

  const startTime = Date.now();
  const bus = new EventEmitter();
  const clients = new Set<WsLike>();

  const app = Fastify({ logger: false });

  // --- Static file serving for the dashboard ---
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // In dev (tsx): src/gateway/ -> src/dashboard/
  // In dist: dist/gateway/ -> check for src/dashboard/ relative to project root
  const dashboardDir = resolve(__dirname, '..', 'dashboard');
  if (existsSync(dashboardDir)) {
    app.register(fastifyStatic, {
      root: dashboardDir,
      prefix: '/',
      decorateReply: true,
    });
  }

  // --- WebSocket ---
  app.register(fastifyWebsocket);

  app.register(async (fastify) => {
    fastify.get('/ws', { websocket: true }, (socket) => {
      clients.add(socket);
      socket.on('close', () => clients.delete(socket));

      // Send initial state
      const agents = router.listAgents();
      const agentList = Array.from(agents.entries()).map(([name, a]) => ({
        name, model: a.config.model, status: a.status,
      }));
      send(socket, { type: 'connected', agents: agentList });

      // Per-client state for approval flow
      let pendingApproval: ((result: ApprovalResult) => void) | null = null;

      socket.on('message', (raw: Buffer | string) => {
        let msg: ClientMessage;
        try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); }
        catch { return; }

        if (msg.type === 'message' && msg.channelId && msg.text) {
          handleChatMessage(socket, msg.channelId, msg.text, (resolve) => {
            pendingApproval = resolve;
          });
        } else if (msg.type === 'approval_response' && pendingApproval) {
          const resolve = pendingApproval;
          pendingApproval = null;
          if (msg.feedback) {
            resolve({ action: 'feedback', message: msg.feedback });
          } else if (msg.rewrittenArgs) {
            resolve({ action: 'rewrite', args: msg.rewrittenArgs });
          } else if (msg.approve) {
            resolve({ action: 'approve' });
          } else {
            resolve({ action: 'deny', reason: 'Denied by user.' });
          }
        } else if (msg.type === 'command' && msg.channelId && msg.name) {
          handleCommand(socket, msg.channelId, msg.name, msg.args ?? '');
        }
      });
    });
  });

  function send(socket: WsLike, msg: ServerMessage): void {
    if (socket.readyState === 1) socket.send(JSON.stringify(msg));
  }

  async function handleChatMessage(
    socket: WsLike,
    channelId: string,
    text: string,
    setApprovalResolver: (resolve: (result: ApprovalResult) => void) => void,
  ): Promise<void> {
    const onStream = (chunk: StreamChunk) => {
      if (chunk.type === 'text' && chunk.text) {
        send(socket, { type: 'stream', text: chunk.text });
      }
    };

    const onApproval = async (request: { toolName: string; args: Record<string, unknown> }) => {
      send(socket, { type: 'approval_request', toolName: request.toolName, args: request.args });
      return new Promise<ApprovalResult>((resolve) => {
        setApprovalResolver(resolve);
      });
    };

    try {
      const result = await router.route(
        { channelType: 'tui', chatId: channelId, text, sender: 'ws-client' },
        onStream,
        onApproval,
      );
      send(socket, {
        type: 'done',
        reply: result.reply,
        usage: result.usage,
        toolResults: result.toolResults.map((r) => ({
          name: r.name, durationMs: r.durationMs, error: r.error,
        })),
      });
    } catch (err) {
      send(socket, { type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  function handleCommand(socket: WsLike, channelId: string, name: string, args: string): void {
    const agents = router.listAgents();
    const firstAgent = agents.values().next().value;
    if (!firstAgent) {
      send(socket, { type: 'error', message: 'No agents registered' });
      return;
    }
    // Use the same binding key format the router uses for messages
    const bindingKey = `tui:${channelId}`;
    const conversation = firstAgent.getOrCreateConversation(bindingKey);
    const result = handleBuiltin(name, args, {
      agentName: firstAgent.config.name,
      model: firstAgent.config.model,
      conversationId: conversation.id,
      status: firstAgent.status,
      resetConversation: () => router.resetChannel('tui', channelId),
    });
    if (result) {
      send(socket, { type: 'command_result', text: result.text, action: result.action });
    } else {
      send(socket, { type: 'error', message: `Unknown command: /${name}` });
    }
  }

  // --- HTTP routes ---

  app.get('/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
  }));

  app.get('/api/agents', async () => {
    const agents = router.listAgents();
    const list = [];
    for (const [name, agent] of agents) {
      list.push({
        name,
        model: agent.config.model,
        role: agent.config.role,
        status: agent.status,
      });
    }
    return { agents: list };
  });

  app.get<{ Params: { name: string } }>('/api/agents/:name', async (request, reply) => {
    const { name } = request.params;
    const agent = router.getAgent(name);
    if (!agent) {
      reply.code(404);
      return { error: `Agent "${name}" not found` };
    }

    const tools = agent.registry.getDefinitions().map((t) => ({
      name: t.name,
      description: t.description,
    }));

    return {
      name: agent.config.name,
      model: agent.config.model,
      role: agent.config.role,
      status: agent.status,
      systemPrompt: agent.config.systemPrompt?.substring(0, 200),
      tools,
    };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/conversations', async (request) => {
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
    const rows = conversationStore.listConversations(limit);
    return {
      conversations: rows.map((r) => {
        const last = conversationStore.getLastMessage(r.id);
        return {
          id: r.id,
          agentName: r.agent_name,
          channelId: r.channel_id,
          status: r.status,
          messageCount: conversationStore.countMessages(r.id),
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          lastMessageAt: last?.created_at,
          lastMessageRole: last?.role,
          lastMessageExcerpt: last ? last.content.slice(0, 100) + (last.content.length > 100 ? '...' : '') : undefined,
        };
      }),
    };
  });

  app.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>('/api/conversations/:id/traces', async (request) => {
    const { id } = request.params;
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : undefined;
    const traces = traceStore.getTraces(id, limit);
    return { conversationId: id, traces };
  });

  app.get<{
    Params: { agentName: string };
    Querystring: { query?: string; limit?: string };
  }>('/api/memory/:agentName', async (request) => {
    const { agentName } = request.params;
    const { query, limit: limitStr } = request.query;
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    if (query) {
      const results = memoryStore.search(agentName, query, limit ?? 10);
      return { agentName, query, memories: results };
    }
    const results = memoryStore.getAll(agentName, limit ?? 50);
    return { agentName, memories: results };
  });

  app.get('/api/tools/stats', async () => {
    // Hardcoded placeholder — will be wired to journal query later
    return {
      stats: [
        { name: 'memory_search', calls: 0, avgDurationMs: 0 },
        { name: 'memory_write', calls: 0, avgDurationMs: 0 },
        { name: 'shell', calls: 0, avgDurationMs: 0 },
      ],
    };
  });

  function broadcastTrace(trace: TraceEntry): void {
    const message = JSON.stringify({ type: 'trace', data: trace });
    for (const ws of clients) {
      if (ws.readyState === 1) {
        ws.send(message);
      }
    }
    bus.emit('trace', trace);
  }

  return {
    async start() {
      await app.listen({ port, host });
      console.log(`Gateway listening on http://${host}:${port}`);
      console.log(`Dashboard: http://localhost:${port}/`);
    },

    async stop() {
      for (const ws of clients) ws.close();
      clients.clear();
      await app.close();
    },

    broadcastTrace,
  };
}
