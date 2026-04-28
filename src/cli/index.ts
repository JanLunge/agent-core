#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import * as readline from 'node:readline';
import { loadConfig } from '../config/loader.js';
import { createProvider, initProviders, setSecretResolver } from '../llm/client.js';
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
import { getMasterKey } from '../secrets/keychain.js';
import { Vault } from '../secrets/vault.js';
import { AuditLog } from '../secrets/audit.js';
import { SecretResolver } from '../secrets/resolver.js';
import { CostTracker, createCostTrackingProvider } from '../llm/cost.js';
import { runRuntimeSmoke } from './runtime-smoke.js';
import { startRuntimeTelegramSpike } from './runtime-telegram-spike.js';
import { runAuditExport, runAuditSnapshot } from './audit-export.js';
import { renderTelegramAuditFixture, runTelegramAuditFixture } from './audit-export-fixture.js';

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

  // Warn about inline secrets
  for (const p of config.master.providers) {
    if (p.api_key) {
      console.warn(`⚠ Provider "${p.name}" has an inline API key in config.yaml. Use api_key_env instead.`);
      console.warn(`  Run \`agent-core setup\` to fix this.\n`);
    }
  }
  if (config.master.telegram.token) {
    console.warn('⚠ Telegram token is inline in config.yaml. Use TELEGRAM_BOT_TOKEN env var instead.');
    console.warn('  Run `agent-core setup` to fix this.\n');
  }

  // Initialize secret resolver (vault + audit)
  const dataDir = resolve(baseDir, config.master.data_dir);
  const masterKey = getMasterKey();
  let secretResolver: SecretResolver | undefined;
  if (masterKey) {
    const vault = new Vault(resolve(dataDir, 'vault.age'), masterKey);
    await vault.load();
    const audit = new AuditLog(dataDir);
    secretResolver = new SecretResolver(vault, audit);
    setSecretResolver(secretResolver);
  }

  initProviders(config.master.providers);

  const agentName = opts.agent ?? [...config.resolved.keys()][0];
  const agentConfig = config.resolved.get(agentName);
  if (!agentConfig) {
    console.error(`Agent "${agentName}" not found. Available: ${[...config.resolved.keys()].join(', ')}`);
    process.exit(1);
  }

  if (opts.model) agentConfig.model = opts.model;

  const costTracker = new CostTracker();
  const rawProvider = resolveProvider(config, agentConfig.provider);
  const provider = createCostTrackingProvider(rawProvider, costTracker);
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

  const agent = createAgent({ config: agentConfig, provider, store, registry, memoryStore, identityStore, secretResolver, toolPolicy, traceStore, baseDir });
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

  return { config, agentConfig, agent, router, registry, traceStore, store, memoryStore, secretResolver, costTracker, mcpConnections, baseDir, cleanup };
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
    const { config, agentConfig, agent, router, traceStore, memoryStore, store, secretResolver, costTracker, baseDir, cleanup } = await setupAgent(opts);

    const shutdownHandlers: (() => void)[] = [cleanup];

    // Start gateway server
    const gateway = createGateway({
      port: 3120,
      router,
      traceStore,
      memoryStore,
      conversationStore: store,
      config,
      costTracker,
    });
    await gateway.start();
    shutdownHandlers.push(() => { gateway.stop(); });

    // Start Telegram if configured
    const telegramConfig = config.master.telegram;
    const telegramToken = secretResolver?.resolve('TELEGRAM_BOT_TOKEN', 'telegram')
      ?? telegramConfig.token
      ?? process.env.TELEGRAM_BOT_TOKEN;
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

    // Start heartbeat
    const hbConfig = config.master.heartbeat;
    if (hbConfig.enabled) {
      const heartbeat = new HeartbeatScheduler({
        config: {
          intervalMinutes: hbConfig.interval_minutes,
          quietHoursStart: hbConfig.quiet_hours_start,
          quietHoursEnd: hbConfig.quiet_hours_end,
          promptFile: hbConfig.prompt_file,
          prompt: hbConfig.prompt,
          baseDir,
        },
        agent,
        channelId: 'heartbeat',
      });
      heartbeat.start();
      shutdownHandlers.push(() => heartbeat.stop());
    }

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

program
  .command('runtime-smoke <message>')
  .description('Run a deterministic local runtime smoke path without external services')
  .option('-p, --persona <name>', 'Persona/agent name', 'mira')
  .option('-s, --store <path>', 'Local HeaperMemory JSON store path')
  .option('-c, --channel <id>', 'Synthetic channel id', 'local')
  .action(async (message: string, opts: { persona: string; store?: string; channel: string }) => {
    try {
      const result = await runRuntimeSmoke({
        message,
        persona: opts.persona,
        storePath: opts.store ? resolve(opts.store) : undefined,
        channel: opts.channel,
      });
      console.log(result.lines.join('\n'));
    } catch (err) {
      console.error('Runtime smoke failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('audit-export <ref>')
  .description('Export a readable linked audit trail from a LocalHeaperMemory store block ref')
  .requiredOption('-s, --store <path>', 'Local HeaperMemory JSON store path')
  .option('-d, --depth <n>', 'Maximum link traversal depth', '5')
  .action(async (ref: string, opts: { store: string; depth: string }) => {
    try {
      const maxDepth = Number.parseInt(opts.depth, 10);
      if (!Number.isFinite(maxDepth) || maxDepth < 0) throw new Error(`Invalid depth: ${opts.depth}`);
      console.log(await runAuditExport({ storePath: resolve(opts.store), ref, maxDepth }));
    } catch (err) {
      console.error('Audit export failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('audit-snapshot <ref>')
  .description('Create a bounded audit snapshot block from a LocalHeaperMemory store block ref')
  .requiredOption('-s, --store <path>', 'Local HeaperMemory JSON store path')
  .option('--heap <heap>', 'Heap for the snapshot block', 'agent/audit')
  .option('-d, --depth <n>', 'Maximum link traversal depth', '5')
  .option('-m, --max-chars <n>', 'Maximum snapshot content characters', '4000')
  .action(async (ref: string, opts: { store: string; heap: string; depth: string; maxChars: string }) => {
    try {
      const maxDepth = Number.parseInt(opts.depth, 10);
      const maxChars = Number.parseInt(opts.maxChars, 10);
      if (!Number.isFinite(maxDepth) || maxDepth < 0) throw new Error(`Invalid depth: ${opts.depth}`);
      if (!Number.isFinite(maxChars) || maxChars < 1) throw new Error(`Invalid max chars: ${opts.maxChars}`);
      console.log(await runAuditSnapshot({
        storePath: resolve(opts.store),
        ref,
        snapshotHeap: opts.heap as `human/${string}` | `agent/${string}` | `persona/${string}/${string}`,
        maxDepth,
        maxChars,
      }));
    } catch (err) {
      console.error('Audit snapshot failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('audit-export-fixture')
  .description('Create a deterministic Telegram-spike-like runtime store and print its audit export command/output')
  .option('-s, --store <path>', 'Local HeaperMemory JSON store path to create; defaults to a temp fixture store')
  .option('-d, --depth <n>', 'Maximum link traversal depth', '6')
  .action(async (opts: { store?: string; depth: string }) => {
    try {
      const maxDepth = Number.parseInt(opts.depth, 10);
      if (!Number.isFinite(maxDepth) || maxDepth < 0) throw new Error(`Invalid depth: ${opts.depth}`);
      const result = await runTelegramAuditFixture({
        storePath: opts.store ? resolve(opts.store) : undefined,
        maxDepth,
      });
      console.log(renderTelegramAuditFixture(result));
    } catch (err) {
      console.error('Audit export fixture failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('runtime-telegram-spike')
  .description('Run a Telegram bot that exercises the new runtime path with durable memory, routing, guards, approvals, and audit refs')
  .requiredOption('-s, --store <path>', 'Local HeaperMemory JSON store path')
  .option('-t, --token <token>', 'Telegram bot token; defaults to TELEGRAM_BOT_TOKEN env var')
  .option('-u, --allowed-user <id...>', 'Allowed Telegram user id(s)')
  .action(async (opts: { store: string; token?: string; allowedUser?: string[] }) => {
    const token = opts.token ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error('Runtime Telegram spike needs --token or TELEGRAM_BOT_TOKEN.');
      process.exit(1);
    }
    const allowedUsers = opts.allowedUser?.map((id) => Number(id)).filter(Number.isFinite);
    const { stop } = await startRuntimeTelegramSpike({
      token,
      storePath: resolve(opts.store),
      allowedUsers: allowedUsers && allowedUsers.length > 0 ? allowedUsers : undefined,
    });
    const shutdown = () => {
      stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

const secrets = program.command('secrets').description('Manage encrypted secrets vault');

secrets
  .command('add <label>')
  .description('Add a secret to the vault')
  .option('-d, --dir <path>', 'Base directory', '.')
  .action(async (label: string, opts: { dir: string }) => {
    const baseDir = resolve(opts.dir);
    const config = loadConfig(baseDir);
    const dataDir = resolve(baseDir, config.master.data_dir);

    const masterKey = getMasterKey();
    if (!masterKey) {
      console.error('No master key found. Set AGENT_CORE_MASTER_KEY env var or store in macOS Keychain.');
      process.exit(1);
    }

    const vault = new Vault(resolve(dataDir, 'vault.age'), masterKey);
    await vault.load();

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const value = await new Promise<string>((res) => {
      rl.question(`  Enter value for "${label}": `, (v) => { rl.close(); res(v.trim()); });
    });

    if (!value) { console.error('No value provided.'); process.exit(1); }

    vault.set(label, value);
    await vault.save();

    const audit = new AuditLog(dataDir);
    audit.log({ action: 'add', label, granted: true });

    console.log(`Secret "${label}" added to vault.`);
  });

secrets
  .command('list')
  .description('List secret labels (values are never shown)')
  .option('-d, --dir <path>', 'Base directory', '.')
  .action(async (opts: { dir: string }) => {
    const baseDir = resolve(opts.dir);
    const config = loadConfig(baseDir);
    const dataDir = resolve(baseDir, config.master.data_dir);

    const masterKey = getMasterKey();
    if (!masterKey) {
      console.error('No master key found. Set AGENT_CORE_MASTER_KEY env var.');
      process.exit(1);
    }

    const vault = new Vault(resolve(dataDir, 'vault.age'), masterKey);
    await vault.load();

    const labels = vault.list();
    if (labels.length === 0) {
      console.log('Vault is empty.');
    } else {
      console.log(`Secrets (${labels.length}):`);
      for (const l of labels) console.log(`  ${l}`);
    }
  });

secrets
  .command('remove <label>')
  .description('Remove a secret from the vault')
  .option('-d, --dir <path>', 'Base directory', '.')
  .action(async (label: string, opts: { dir: string }) => {
    const baseDir = resolve(opts.dir);
    const config = loadConfig(baseDir);
    const dataDir = resolve(baseDir, config.master.data_dir);

    const masterKey = getMasterKey();
    if (!masterKey) { console.error('No master key found.'); process.exit(1); }

    const vault = new Vault(resolve(dataDir, 'vault.age'), masterKey);
    await vault.load();

    if (vault.delete(label)) {
      await vault.save();
      const audit = new AuditLog(dataDir);
      audit.log({ action: 'remove', label, granted: true });
      console.log(`Secret "${label}" removed.`);
    } else {
      console.log(`Secret "${label}" not found.`);
    }
  });

secrets
  .command('migrate')
  .description('Import secrets from environment variables into the vault')
  .option('-d, --dir <path>', 'Base directory', '.')
  .action(async (opts: { dir: string }) => {
    const baseDir = resolve(opts.dir);
    const config = loadConfig(baseDir);
    const dataDir = resolve(baseDir, config.master.data_dir);

    const masterKey = getMasterKey();
    if (!masterKey) { console.error('No master key found. Set AGENT_CORE_MASTER_KEY env var.'); process.exit(1); }

    const vault = new Vault(resolve(dataDir, 'vault.age'), masterKey);
    await vault.load();
    const audit = new AuditLog(dataDir);

    let imported = 0;

    // Import provider API keys
    for (const p of config.master.providers) {
      if (p.api_key_env && process.env[p.api_key_env]) {
        vault.set(p.api_key_env, process.env[p.api_key_env]!);
        audit.log({ action: 'add', label: p.api_key_env, scope: 'migrate', granted: true });
        console.log(`  Imported ${p.api_key_env}`);
        imported++;
      }
    }

    // Import Telegram token
    if (process.env.TELEGRAM_BOT_TOKEN) {
      vault.set('TELEGRAM_BOT_TOKEN', process.env.TELEGRAM_BOT_TOKEN);
      audit.log({ action: 'add', label: 'TELEGRAM_BOT_TOKEN', scope: 'migrate', granted: true });
      console.log('  Imported TELEGRAM_BOT_TOKEN');
      imported++;
    }

    if (imported > 0) {
      await vault.save();
      console.log(`\nMigrated ${imported} secret(s) to vault.`);
      console.log('You can now remove these env vars from your shell. Only AGENT_CORE_MASTER_KEY is needed.');
    } else {
      console.log('No secrets found in environment to migrate.');
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
