import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface OpenClawAuthProfileStore {
  profiles?: Record<string, OpenClawAuthProfile>;
}

interface OpenClawAuthProfile {
  type?: string;
  provider?: string;
  key?: string;
  token?: string;
  access?: string;
  expires?: number;
}

export interface ResolveOpenClawAuthOptions {
  provider: string;
  profileId?: string;
  homeDir?: string;
  now?: number;
}

export function resolveOpenClawAuthToken(options: ResolveOpenClawAuthOptions): string | undefined {
  const homeDir = options.homeDir ?? process.env.HOME;
  if (!homeDir) return undefined;

  const storePath = join(homeDir, '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json');
  let store: OpenClawAuthProfileStore;
  try {
    store = JSON.parse(readFileSync(storePath, 'utf8')) as OpenClawAuthProfileStore;
  } catch {
    return undefined;
  }

  const profiles = store.profiles ?? {};
  const profile = options.profileId
    ? profiles[options.profileId]
    : chooseBestProfile(profiles, options.provider, options.now ?? Date.now());

  if (!profile || profile.provider !== options.provider) return undefined;
  if (profile.type === 'api_key') return firstNonEmpty(profile.key, profile.token, profile.access);
  if (profile.type === 'oauth') {
    if (typeof profile.expires === 'number' && profile.expires <= (options.now ?? Date.now())) return undefined;
    return firstNonEmpty(profile.access, profile.token, profile.key);
  }
  return undefined;
}

function chooseBestProfile(
  profiles: Record<string, OpenClawAuthProfile>,
  provider: string,
  now: number,
): OpenClawAuthProfile | undefined {
  const usable = Object.entries(profiles)
    .filter(([, profile]) => profile.provider === provider)
    .filter(([, profile]) => profile.type === 'api_key' || profile.type === 'oauth')
    .filter(([, profile]) => typeof profile.expires !== 'number' || profile.expires > now)
    .sort(([aId, a], [bId, b]) => {
      if (aId === `${provider}:default`) return -1;
      if (bId === `${provider}:default`) return 1;
      return (b.expires ?? Number.MAX_SAFE_INTEGER) - (a.expires ?? Number.MAX_SAFE_INTEGER);
    });
  return usable[0]?.[1];
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();
}
