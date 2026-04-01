#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'node:path';
import { loadConfig } from '../config/loader.js';
import { createProvider, initProviders } from '../llm/client.js';
import { createAgent } from '../agent/agent.js';
import { ConversationStore } from '../conversation/persistence.js';
import { createRouter } from '../router/router.js';
import { startTui } from '../tui/app.js';
import { ToolRegistry } from '../tools/registry.js';
import { registerCoreTools } from '../tools/core.js';
import { TraceStore } from '../journal/trace.js';
import { MemoryStore } from '../memory/store.js';
import { createToolPolicy } from '../tools/policy.js';

const program = new Command();

program
  .name('agent-core')
  .description('Agent Core — conversational agent framework')
  .version('0.1.0');

program
  .command('chat')
  .description('Start an interactive chat session with an agent')
  .option('-d, --dir <path>', 'Base directory for config, roles, agents', '.')
  .option('-a, --agent <name>', 'Agent name to chat with (defaults to first found)')
  .option('-m, --model <model>', 'Override the model (e.g. claude-sonnet-4, gpt-4o)')
  .option('-v, --verbose', 'Show token usage and debug info')
  .action(async (opts) => {
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

    // Set up tool registry and policy
    const registry = new ToolRegistry();
    registerCoreTools(registry);

    // memory tools auto-approve, everything else asks
    const toolPolicy = createToolPolicy({
      auto: ['memory_search', 'memory_write'],
    });

    const agent = createAgent({ config: agentConfig, provider, store, registry, memoryStore, toolPolicy, traceStore, baseDir });
    const router = createRouter();
    router.registerAgent(agentConfig.name, agent);
    router.setDefaultAgent(agentConfig.name);

    const shutdown = () => {
      console.log('\nShutting down...');
      agent.stop();
      store.close();
      traceStore.close();
      memoryStore.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await startTui({ router, agentName: agentConfig.name, verbose: opts.verbose });
    agent.stop();
    store.close();
    traceStore.close();
    memoryStore.close();
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
    } catch (err) {
      console.error('Failed to load config:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
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
