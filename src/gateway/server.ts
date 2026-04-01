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
      socket.send(JSON.stringify({ type: 'connected', data: { uptime: Date.now() - startTime } }));
    });
  });

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
