import { z } from 'zod';

// --- Provider ---

export const ProviderProfileSchema = z.object({
  name: z.string(),
  type: z.enum(['openai-compatible', 'anthropic', 'local']),
  base_url: z.string().optional(),
  api_key_env: z.string().optional(),
  api_key: z.string().optional(),
  default_model: z.string().optional(),
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
