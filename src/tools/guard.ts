export type GuardSurface = 'shell' | 'file' | 'api' | 'tool';
export type GuardAction = 'read' | 'write' | 'execute' | 'delete' | 'network';
export type GuardDisposition = 'allow' | 'ask' | 'deny';

export interface GuardRequest {
  surface: GuardSurface;
  action: GuardAction;
  target: string;
  command?: string;
  sensitiveMode?: boolean;
  external?: boolean;
  destructive?: boolean;
  metadata?: Record<string, unknown>;
}

export interface GuardDecision {
  disposition: GuardDisposition;
  reason: string;
  request: GuardRequest;
  audit: {
    surface: GuardSurface;
    action: GuardAction;
    target: string;
    sensitiveMode: boolean;
    external: boolean;
    destructive: boolean;
  };
}

const SECRET_TARGET_PATTERNS = [
  /(^|\/)\.env(\.|$|\/)?/i,
  /(^|\/)(id_rsa|id_ed25519|credentials|secrets?)(\.|$|\/)?/i,
  /(^|\/)\.ssh(\/|$)/i,
  /keychain/i,
];

const RISKY_SHELL_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bchmod\s+(-R\s+)?777\b/i,
  /\b(openclaw|systemctl|launchctl)\s+(restart|stop|start)\b/i,
];

/**
 * Central command/file/API guard.
 *
 * This is intentionally deterministic and auditable: callers can decide how to
 * ask the human, but the guard always returns a reasoned allow/ask/deny object.
 */
export function decideGuard(request: GuardRequest): GuardDecision {
  const normalized: GuardRequest = {
    ...request,
    sensitiveMode: request.sensitiveMode ?? false,
    external: request.external ?? inferExternal(request),
    destructive: request.destructive ?? inferDestructive(request),
  };

  const denyReason = denyReasonFor(normalized);
  if (denyReason) return decision('deny', denyReason, normalized);

  const askReason = askReasonFor(normalized);
  if (askReason) return decision('ask', askReason, normalized);

  return decision('allow', 'Safe local operation.', normalized);
}

function denyReasonFor(request: GuardRequest): string | undefined {
  if (request.sensitiveMode && request.external) {
    return 'Sensitive mode blocks external/network operations.';
  }

  if (isSecretLikeTarget(request.target) && request.action === 'read') {
    return 'Secret-like target reads are blocked by the guard.';
  }

  if (request.action === 'delete' && isSecretLikeTarget(request.target)) {
    return 'Secret-like target deletion is blocked by the guard.';
  }

  return undefined;
}

function askReasonFor(request: GuardRequest): string | undefined {
  if (request.destructive) return 'Destructive operation requires explicit approval.';
  if (request.action === 'write') return 'Write operation requires approval unless separately pre-approved.';
  if (request.surface === 'api' && request.external) return 'External API operation requires approval.';
  if (request.surface === 'shell' && request.command && isRiskyShell(request.command)) {
    return 'Risky shell command requires explicit approval.';
  }
  return undefined;
}

function inferExternal(request: GuardRequest): boolean {
  if (request.surface === 'api') return /^https?:\/\//i.test(request.target);
  if (request.surface === 'shell') return /\b(curl|wget|ssh|scp|rsync|gh\s+api)\b/i.test(request.command ?? request.target);
  return false;
}

function inferDestructive(request: GuardRequest): boolean {
  if (request.action === 'delete') return true;
  if (request.surface === 'shell') return /\b(rm|mv|truncate|dd|mkfs|killall)\b/i.test(request.command ?? request.target);
  return false;
}

function isSecretLikeTarget(target: string): boolean {
  return SECRET_TARGET_PATTERNS.some((pattern) => pattern.test(target));
}

function isRiskyShell(command: string): boolean {
  return RISKY_SHELL_PATTERNS.some((pattern) => pattern.test(command));
}

function decision(disposition: GuardDisposition, reason: string, request: GuardRequest): GuardDecision {
  return {
    disposition,
    reason,
    request,
    audit: {
      surface: request.surface,
      action: request.action,
      target: request.target,
      sensitiveMode: Boolean(request.sensitiveMode),
      external: Boolean(request.external),
      destructive: Boolean(request.destructive),
    },
  };
}
