import { execSync } from 'node:child_process';

/**
 * Retrieve the master key from environment or macOS Keychain.
 * Returns undefined if neither source has it.
 */
export function getMasterKey(): string | undefined {
  const envKey = process.env.AGENT_CORE_MASTER_KEY;
  if (envKey) return envKey;

  try {
    const result = execSync(
      'security find-generic-password -s agent-core -w',
      {
        encoding: 'utf-8',
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    if (result) return result;
  } catch {
    // Not on macOS, or no keychain entry — silently fall through.
  }

  return undefined;
}

/**
 * Store the master key in the macOS Keychain.
 * Returns true on success, false on failure (e.g. not macOS).
 */
export function storeMasterKeyInKeychain(key: string): boolean {
  try {
    execSync(
      `security add-generic-password -s agent-core -a agent-core -w "${key}" -U`,
      {
        encoding: 'utf-8',
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
        stdio: 'ignore',
      },
    );
    return true;
  } catch {
    return false;
  }
}
