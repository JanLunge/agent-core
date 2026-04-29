import type { ProviderProfile } from '../config/schema.js';
import type { LLMProvider } from './types.js';
import type { SecretResolver } from '../secrets/resolver.js';
import { createOpenAIProvider } from './openai-provider.js';
import { createOpenAICodexProvider } from './openai-codex-provider.js';
import { createCodexCliProvider } from './codex-cli-provider.js';
import { resolveOpenClawAuthToken } from './openclaw-auth.js';

const providers = new Map<string, LLMProvider>();

export function resolveApiKey(profile: ProviderProfile, resolver?: SecretResolver): string | undefined {
  if (profile.api_key) return profile.api_key;
  // Try vault first (label = env var name or provider_name_api_key)
  if (resolver) {
    const label = profile.api_key_env ?? `${profile.name}_api_key`;
    const fromVault = resolver.resolve(label, 'llm-provider');
    if (fromVault) return fromVault;
  }
  // Fall back to env var
  if (profile.api_key_env && process.env[profile.api_key_env]) return process.env[profile.api_key_env];
  // Temporary compatibility bridge: reuse OpenClaw's provider auth profile at runtime
  // without copying token material into agent-core config or vault.
  if (profile.type === 'openai-codex') {
    return resolveOpenClawAuthToken({
      provider: 'openai-codex',
      profileId: profile.openclaw_auth_profile,
    });
  }
  return undefined;
}

let activeResolver: SecretResolver | undefined;

export function setSecretResolver(resolver: SecretResolver): void {
  activeResolver = resolver;
}

export function createProvider(profile: ProviderProfile, resolver?: SecretResolver): LLMProvider {
  const apiKey = resolveApiKey(profile, resolver ?? activeResolver);

  switch (profile.type) {
    case 'openai-compatible':
      return createOpenAIProvider(profile.name, {
        apiKey,
        baseURL: profile.base_url,
      });

    case 'anthropic':
      // Route through OpenAI-compatible layer for now.
      // Anthropic's API is available via their OpenAI-compatible endpoint
      // or via a local proxy.
      return createOpenAIProvider(profile.name, {
        apiKey,
        baseURL: profile.base_url ?? 'https://api.anthropic.com/v1',
      });

    case 'local':
      // Local providers (Ollama, LM Studio) expose OpenAI-compatible endpoints
      return createOpenAIProvider(profile.name, {
        apiKey: apiKey ?? 'local',
        baseURL: profile.base_url ?? 'http://localhost:11434/v1',
      });

    case 'openai-codex':
      // ChatGPT/Codex subscription API-style route. Unlike codex-cli, this is
      // intended for the normal agent-core tool loop so approvals stay central.
      return createOpenAICodexProvider(profile.name, {
        accessToken: apiKey,
        baseURL: profile.base_url,
      });

    case 'codex-cli':
      // Uses the official Codex CLI's existing OAuth login. Agent Core never reads
      // token files or .env secrets; Jan owns `codex login` / OAuth setup.
      return createCodexCliProvider(profile.name, {
        command: profile.command,
        cwd: profile.cwd,
        timeoutMs: profile.timeout_ms,
      });

    default:
      throw new Error(`Unknown provider type: ${profile.type}`);
  }
}

export function initProviders(profiles: ProviderProfile[]): Map<string, LLMProvider> {
  for (const profile of profiles) {
    const provider = createProvider(profile);
    providers.set(profile.name, provider);
  }
  return providers;
}

export function getProvider(name: string): LLMProvider {
  const provider = providers.get(name);
  if (!provider) {
    throw new Error(`Provider "${name}" not found. Available: ${[...providers.keys()].join(', ')}`);
  }
  return provider;
}
