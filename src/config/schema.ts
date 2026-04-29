import { z } from 'zod';

// --- Provider ---

export const ProviderProfileSchema = z.object({
  name: z.string(),
  type: z.enum(['openai-compatible', 'anthropic', 'local', 'openai-codex', 'codex-cli']),
  base_url: z.string().optional(),
  api_key_env: z.string().optional(),
  api_key: z.string().optional(),
  default_model: z.string().optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  timeout_ms: z.number().optional(),
});

export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;

// --- Tool permissions ---

export const ToolPermissionsSchema = z.object({
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
});

export type ToolPermissions = z.infer<typeof ToolPermissionsSchema>;

// --- Role ---

export const RoleSchema = z.object({
  name: z.string(),
  description: z.string(),
  default_model: z.string().optional(),
  personality: z.string().optional(),
  skills: z.array(z.string()).default([]),
  tools: ToolPermissionsSchema.optional(),
  system_prompt: z.string().optional(),
});

export type Role = z.infer<typeof RoleSchema>;

// --- Agent ---

export const AgentSchema = z.object({
  name: z.string(),
  role: z.string(),
  model: z.string().optional(),
  provider: z.string().optional(),
  personality: z.string().optional(),
  knows_about: z.union([z.string(), z.array(z.string())]).optional(),
  skills: z.array(z.string()).optional(),
  tools: ToolPermissionsSchema.optional(),
  system_prompt: z.string().optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
});

export type Agent = z.infer<typeof AgentSchema>;

// --- MCP server ---

export const McpServerConfigSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

export type McpServerConfigZ = z.infer<typeof McpServerConfigSchema>;

// --- Telegram channel ---

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Bot token. Falls back to TELEGRAM_BOT_TOKEN env var when omitted. */
  token: z.string().optional(),
  allowed_users: z.array(z.number()).optional(),
  allowed_groups: z.array(z.number()).optional(),
});

export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

// --- Embedding config ---

export const EmbeddingConfigSchema = z.object({
  provider: z.enum(['ollama', 'openai']).default('ollama'),
  model: z.string().optional(),
  base_url: z.string().optional(),
  api_key_env: z.string().optional(),
  dimensions: z.number().optional(),
});

export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;

// --- Runtime memory ---

export const RuntimeMemoryConfigSchema = z.object({
  kind: z.enum(['memory', 'local', 'heaper']).default('memory'),
  /** Path for local durable HeaperMemory JSON storage. Relative to base dir when not absolute. */
  path: z.string().optional(),
  id_prefix: z.string().optional(),
  /** Feature flag for the non-functional future Heaper adapter skeleton. */
  heaper_enabled: z.boolean().optional(),
  heaper_endpoint: z.string().optional(),
  heaper_namespace: z.string().optional(),
  heaper_api_key_env: z.string().optional(),
}).default({});

export type RuntimeMemoryConfig = z.infer<typeof RuntimeMemoryConfigSchema>;

// --- Master config ---

export const MasterConfigSchema = z.object({
  data_dir: z.string().default('./data'),
  providers: z.array(ProviderProfileSchema).default([]),
  default_provider: z.string().optional(),
  default_model: z.string().optional(),
  roles_dir: z.string().default('./roles'),
  agents_dir: z.string().default('./agents'),
  logging: z.object({
    level: z.string().default('info'),
  }).default({}),
  history: z.object({
    max_turns: z.number().default(100),
  }).default({}),
  prompt: z.object({
    max_tokens: z.number().default(8000),
  }).default({}),
  heartbeat: z.object({
    enabled: z.boolean().default(true),
    interval_minutes: z.number().default(60),
    quiet_hours_start: z.number().optional(),
    quiet_hours_end: z.number().optional(),
    /** Path to a file containing the heartbeat prompt. Loaded each tick. */
    prompt_file: z.string().optional(),
    /** Inline prompt (used if prompt_file not set). */
    prompt: z.string().optional(),
  }).default({}),
  mcp_servers: z.array(McpServerConfigSchema).default([]),
  telegram: TelegramConfigSchema.default({}),
  embeddings: EmbeddingConfigSchema.optional(),
  runtime_memory: RuntimeMemoryConfigSchema,
});

export type MasterConfig = z.infer<typeof MasterConfigSchema>;

// --- Resolved agent (merged agent + role + master defaults) ---

export interface ResolvedAgent {
  name: string;
  role: string;
  model: string;
  provider: string;
  personality: string | undefined;
  knowsAbout: string[];
  skills: string[];
  tools: ToolPermissions;
  systemPrompt: string | undefined;
  temperature: number | undefined;
  maxTokens: number | undefined;
}
