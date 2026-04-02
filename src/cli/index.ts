#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'node:path';
import { loadConfig } from '../config/loader.js';
import { createProvider, initProviders } from '../llm/client.js';
import { createAgent } from '../agent/agent.js';
import { ConversationStore } from '../conversation/persistence.js';
import { createRouter } from '../router/router.js';
import { ToolRegistry } from '../tools/registry.js';
import { registerCoreTools } from '../tools/core.js';
import { loadMcpServers } from '../tools/mcp-loader.js';
import type { McpConnection } from '../tools/mcp-client.js';
import { createToolPolicy } from '../tools/policy.js';
import { TraceStore } from '../journal/trace.js';
import { MemoryStore } from '../memory/store.js';
import { IdentityStore } from '../memory/identity-store.js';
import { TelegramConnector } from '../channel/telegram/connector.js';
import { HeartbeatScheduler } from '../heartbeat/scheduler.js';
import { createGateway } from '../gateway/server.js';
import { startWsChat } from '../tui/ws-client.js';
import { runSetup } from './setup.js';

const program = new Command();

program
  .name('agent-core')
  .description('Agent Core — conversational agent framework')
  .version('0.1.0');

// Shared setup used by both `chat` and `start`
async function setupAgent(opts: { dir: string; agent?: string; model?: string }) {
  const baseDir = resolve(opts.dir);
  const config = (() => {
    try { return loadConfig(baseDir); }
    catch (err) {
      console.error('Failed to load config:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  })();

  if (config.resolved.size === 0) {
    console.error('No agents configured. Create an agent YAML file in the agents/ directory.');
    process.exit(1);
  }

  initProviders(config.master.providers);

  const agentName = opts.agent ?? [...config.resolved.keys()][0];
  const agentConfig = config.resolved.get(agentName);
  if (!agentConfig) {
    console.error(`Agent "${agentName}" not found. Available: ${[...config.resolved.keys()].join(', ')}`);
    process.exit(1);
  }

  if (opts.model) agentConfig.model = opts.model;

  const provider = resolveProvider(config, agentConfig.provider);
  const dataDir = resolve(baseDir, config.master.data_dir);
  const store = new ConversationStore(dataDir);
  const traceStore = new TraceStore(dataDir);
  const memoryStore = new MemoryStore(dataDir);
  const identityStore = new IdentityStore(dataDir, baseDir);

  // Import initial identity files into the versioned store
  if (agentConfig.personality) {
    identityStore.importFromDisk('personality', agentConfig.personality);
  }

  const registry = new ToolRegistry();
  registerCoreTools(registry);

  // Load MCP servers
  let mcpConnections: McpConnection[] = [];
  if (config.master.mcp_servers.length > 0) {
    console.log(`Loading ${config.master.mcp_servers.length} MCP server(s)...`);
    mcpConnections = await loadMcpServers(config.master.mcp_servers, registry);
    console.log(`MCP tools loaded: ${mcpConnections.length} server(s) connected`);
  }

  const toolPolicy = createToolPolicy({
    auto: ['memory_*'],
  });

  const agent = createAgent({ config: agentConfig, provider, store, registry, memoryStore, identityStore, toolPolicy, traceStore, baseDir });
  const router = createRouter();
  router.registerAgent(agentConfig.name, agent);
  router.setDefaultAgent(agentConfig.name);

  const cleanup = () => {
    agent.stop();
    store.close();
    traceStore.close();
    memoryStore.close();
    identityStore.close();
    for (const conn of mcpConnections) conn.close();
  };

  return { config, agentConfig, agent, router, registry, traceStore, store, memoryStore, mcpConnections, baseDir, cleanup };
}

program
  .command('chat')
  .description('Connect to a running agent-core server and chat')
  .option('-u, --url <url>', 'Gateway WebSocket URL', 'ws://localhost:3120/ws')
  .option('-c, --channel <id>', 'Channel ID for this session (auto-generated if omitted)')
  .option('-v, --verbose', 'Show token usage and debug info')
  .action(async (opts) => {
    await startWsChat({
      url: opts.url,
      channelId: opts.channel,
      verbose: opts.verbose,
    });
  });

program
  .command('start')
  .description('Start the agent with Telegram, heartbeat, and all channels')
  .option('-d, --dir <path>', 'Base directory', '.')
  .option('-a, --agent <name>', 'Agent name (defaults to first found)')
  .option('-m, --model <model>', 'Override the model')
  .action(async (opts) => {
    const { config, agentConfig, agent, router, traceStore, memoryStore, store, cleanup } = await setupAgent(opts);

    const shutdownHandlers: (() => void)[] = [cleanup];

    // Start gateway server
    const gateway = createGateway({
      port: 3120,
      router,
      traceStore,
      memoryStore,
      conversationStore: store,
    });
    await gateway.start();
    shutdownHandlers.push(() => { gateway.stop(); });

    // Start Telegram if configured
    const telegramConfig = config.master.telegram;
    const telegramToken = telegramConfig.token ?? process.env.TELEGRAM_BOT_TOKEN;
    if (telegramConfig.enabled && telegramToken) {
      const telegram = new TelegramConnector({
        token: telegramToken,
        router,
        allowedUsers: telegramConfig.allowed_users,
        allowedGroups: telegramConfig.allowed_groups,
      });
      await telegram.start();
      console.log(`Telegram bot started for ${agentConfig.name}`);
      shutdownHandlers.push(() => telegram.stop());
    }

    // Start heartbeat if configured
    // TODO: make heartbeat configurable from config.yaml
    const heartbeat = new HeartbeatScheduler({
      config: { intervalMinutes: 60 },
      agent,
      channelId: 'heartbeat',
    });
    heartbeat.start();
    shutdownHandlers.push(() => heartbeat.stop());

    console.log(`\n${agentConfig.name} is running (model: ${agentConfig.model})`);
    console.log('Press Ctrl+C to stop.\n');

    const shutdown = () => {
      console.log('\nShutting down...');
      for (const fn of shutdownHandlers) fn();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep process alive
    await new Promise(() => {});
  });

program
  .command('status')
  .description('Show agent-core status')
  .option('-d, --dir <path>', 'Base directory', '.')
  .action((opts) => {
    const baseDir = resolve(opts.dir);
    try {
      const config = loadConfig(baseDir);
      console.log('Agent Core Status\n');
      console.log(`Roles: ${config.roles.size}`);
      for (const [id, role] of config.roles) {
        console.log(`  ${id}: ${role.name} — ${role.description || '(no description)'}`);
      }
      console.log(`\nAgents: ${config.resolved.size}`);
      for (const [, agent] of config.resolved) {
        console.log(`  ${agent.name} (role: ${agent.role}, model: ${agent.model})`);
      }
      console.log(`\nMCP servers: ${config.master.mcp_servers.length}`);
      for (const s of config.master.mcp_servers) {
        console.log(`  ${s.name}: ${s.command} ${(s.args ?? []).join(' ')}`);
      }
      console.log(`\nTelegram: ${config.master.telegram.enabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      console.error('Failed to load config:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('setup')
  .description('Interactive setup wizard for agent-core')
  .option('-d, --dir <path>', 'Base directory', '.')
  .action(async (opts) => {
    await runSetup(resolve(opts.dir));
  });

function resolveProvider(config: ReturnType<typeof loadConfig>, providerName: string) {
  const profile = config.master.providers.find((p) => p.name === providerName);
  if (profile) return createProvider(profile);

  if (process.env.OPENROUTER_API_KEY) {
    return createProvider({
      name: 'openrouter', type: 'openai-compatible',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: process.env.OPENROUTER_API_KEY,
    });
  }
  if (process.env.OPENAI_API_KEY) {
    return createProvider({
      name: 'openai', type: 'openai-compatible',
      api_key: process.env.OPENAI_API_KEY,
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return createProvider({
      name: 'anthropic', type: 'anthropic',
      api_key: process.env.ANTHROPIC_API_KEY,
    });
  }

  console.warn('No API key found. Trying local LLM at http://localhost:1234/v1');
  return createProvider({ name: 'local', type: 'local', base_url: 'http://localhost:1234/v1' });
}

program.parse();
