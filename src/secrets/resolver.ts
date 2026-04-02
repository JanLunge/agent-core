import type { Vault } from './vault.js';
import type { AuditLog } from './audit.js';

/** Env var keys that are always kept, regardless of name pattern. */
const ESSENTIAL_VARS = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TERM_PROGRAM',
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR',
  'EDITOR',
  'VISUAL',
  'HOSTNAME',
  'LOGNAME',
  'PWD',
  'OLDPWD',
  'SHLVL',
  'TZ',
  'NODE_ENV',
]);

const SENSITIVE_KEY_RE =
  /(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIAL)$/i;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Runtime secret resolver: retrieves secrets from the vault, provides
 * sanitized env for subprocess spawning, and redacts secret values from text.
 */
export class SecretResolver {
  private readonly vault: Vault;
  private readonly audit: AuditLog;

  private cachedEnv: Record<string, string> | null = null;
  private cachedRedactRe: RegExp | null = null;

  constructor(vault: Vault, audit: AuditLog) {
    this.vault = vault;
    this.audit = audit;
  }

  /**
   * Resolve a secret by label. Logs the access to the audit log.
   */
  resolve(label: string, scope?: string): string | undefined {
    const value = this.vault.get(label);
    this.audit.log({
      action: 'resolve',
      label,
      scope,
      granted: value !== undefined,
    });
    return value;
  }

  /**
   * Build a copy of process.env with sensitive entries removed.
   *
   * Removes entries whose key looks like a secret (e.g. *_KEY, *_TOKEN)
   * or whose value matches any known vault secret. Essential vars are kept
   * regardless of key pattern (but still scrubbed if the value matches a secret).
   */
  buildSanitizedEnv(): Record<string, string> {
    if (this.cachedEnv) return this.cachedEnv;

    const knownValues = new Set(this.vault.values());
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;

      // Always remove entries whose value is a known secret.
      if (knownValues.has(value)) continue;

      // Remove entries with sensitive-looking keys, unless essential.
      if (SENSITIVE_KEY_RE.test(key) && !ESSENTIAL_VARS.has(key)) continue;

      env[key] = value;
    }

    this.cachedEnv = env;
    return env;
  }

  /**
   * Replace any occurrence of a known secret value in `text` with `[REDACTED]`.
   * Only redacts values longer than 4 characters to avoid false positives.
   */
  redact(text: string): string {
    const re = this.getRedactRegex();
    if (!re) return text;
    return text.replace(re, '[REDACTED]');
  }

  /** Clear cached sanitized env and redaction regex (call after vault mutations). */
  invalidateCache(): void {
    this.cachedEnv = null;
    this.cachedRedactRe = null;
  }

  // ---- private helpers ----

  private getRedactRegex(): RegExp | null {
    if (this.cachedRedactRe !== undefined && this.cachedRedactRe !== null) {
      return this.cachedRedactRe;
    }

    const values = this.vault
      .values()
      .filter((v) => v.length > 4)
      .sort((a, b) => b.length - a.length);

    if (values.length === 0) {
      this.cachedRedactRe = null;
      return null;
    }

    const pattern = values.map(escapeRegex).join('|');
    this.cachedRedactRe = new RegExp(pattern, 'g');
    return this.cachedRedactRe;
  }
}
