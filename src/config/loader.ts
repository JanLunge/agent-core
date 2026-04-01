import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { watch } from 'chokidar';
import {
  MasterConfigSchema,
  RoleSchema,
  AgentSchema,
  type MasterConfig,
  type Role,
  type Agent,
  type ResolvedAgent,
  type ToolPermissions,
} from './schema.js';

export interface LoadedConfig {
  master: MasterConfig;
  roles: Map<string, Role>;
  agents: Map<string, Agent>;
  resolved: Map<string, ResolvedAgent>;
}

function readYaml(filePath: string): unknown {
  const raw = readFileSync(filePath, 'utf-8');
  return parseYaml(raw);
}

function loadYamlDir<T>(
  dir: string,
  parse: (data: unknown) => T,
  keyFn: (item: T, filename: string) => string,
): Map<string, T> {
  const map = new Map<string, T>();
  if (!existsSync(dir)) return map;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    const filePath = join(dir, file);
    const data = readYaml(filePath);
    const parsed = parse(data);
    const key = keyFn(parsed, file.replace(/\.ya?ml$/, ''));
    map.set(key, parsed);
  }
  return map;
}

function mergeTools(
  role: ToolPermissions | undefined,
  agent: ToolPermissions | undefined,
): ToolPermissions {
  return {
    allow: [...(role?.allow ?? []), ...(agent?.allow ?? [])],
    deny: [...(role?.deny ?? []), ...(agent?.deny ?? [])],
  };
}

function normalizeKnowsAbout(val: string | string[] | undefined): string[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function resolveAgent(
  agent: Agent,
  roles: Map<string, Role>,
  master: MasterConfig,
): ResolvedAgent {
  const role = roles.get(agent.role);
  if (!role) {
    throw new Error(`Agent "${agent.name}" references unknown role "${agent.role}"`);
  }

  return {
    name: agent.name,
    role: agent.role,
    model: agent.model ?? role.default_model ?? master.default_model ?? 'qwen/qwen3.6-plus-preview:free',
    provider: agent.provider ?? master.default_provider ?? 'default',
    personality: agent.personality ?? role.personality,
    knowsAbout: normalizeKnowsAbout(agent.knows_about),
    skills: agent.skills ?? role.skills,
    tools: mergeTools(role.tools, agent.tools),
    systemPrompt: agent.system_prompt ?? role.system_prompt,
    temperature: agent.temperature,
    maxTokens: agent.max_tokens,
  };
}

export function loadConfig(baseDir: string): LoadedConfig {
  const absBase = resolve(baseDir);
  const configPath = join(absBase, 'config.yaml');

  const rawMaster = existsSync(configPath) ? readYaml(configPath) : {};
  const master = MasterConfigSchema.parse(rawMaster);

  const rolesDir = resolve(absBase, master.roles_dir);
  const agentsDir = resolve(absBase, master.agents_dir);

  const roles = loadYamlDir(
    rolesDir,
    (data) => RoleSchema.parse(data),
    (_item, filename) => filename,
  );

  const agents = loadYamlDir(
    agentsDir,
    (data) => AgentSchema.parse(data),
    (_item, filename) => filename,
  );

  const resolved = new Map<string, ResolvedAgent>();
  for (const [id, agent] of agents) {
    resolved.set(id, resolveAgent(agent, roles, master));
  }

  return { master, roles, agents, resolved };
}

export function watchConfig(
  baseDir: string,
  onChange: (config: LoadedConfig) => void,
): { close(): void } {
  const absBase = resolve(baseDir);

  const watcher = watch(
    [
      join(absBase, 'config.yaml'),
      join(absBase, '**/*.yaml'),
      join(absBase, '**/*.yml'),
    ],
    {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200 },
    },
  );

  watcher.on('all', () => {
    try {
      const config = loadConfig(baseDir);
      onChange(config);
    } catch (err) {
      console.error('[config] reload failed:', (err as Error).message);
    }
  });

  return { close: () => watcher.close() };
}
