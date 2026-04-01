import type { ProviderProfile } from '../config/schema.js';
import type { LLMProvider } from './types.js';
import { createOpenAIProvider } from './openai-provider.js';

const providers = new Map<string, LLMProvider>();

export function resolveApiKey(profile: ProviderProfile): string | undefined {
  if (profile.api_key) return profile.api_key;
  if (profile.api_key_env) return process.env[profile.api_key_env];
  return undefined;
}

export function createProvider(profile: ProviderProfile): LLMProvider {
  const apiKey = resolveApiKey(profile);

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
