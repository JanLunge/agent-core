import { routeModel, type ModelRoutingDecision, type ModelRoutingInput } from '../llm/model-routing.js';
import { decideGuard, type GuardDecision, type GuardRequest } from '../tools/guard.js';

export interface SensitiveRuntimeInput {
  model: ModelRoutingInput;
  guards?: GuardRequest[];
}

export interface SensitiveRuntimeViolation {
  kind: 'model' | 'tool';
  reason: string;
  decision?: GuardDecision;
}

export interface SensitiveRuntimeDecision {
  model: ModelRoutingDecision;
  guardDecisions: GuardDecision[];
  violations: SensitiveRuntimeViolation[];
  allowed: boolean;
}

/**
 * Runtime boundary for sensitive mode.
 *
 * This composes model routing and tool/file/API guards so sensitive-mode safety
 * is enforced by typed decisions instead of prompt instructions. Model failures
 * and denied guard decisions are returned as auditable violations.
 */
export function enforceSensitiveRuntime(input: SensitiveRuntimeInput): SensitiveRuntimeDecision {
  const sensitivity = input.model.sensitivity;
  const violations: SensitiveRuntimeViolation[] = [];
  let model: ModelRoutingDecision;

  try {
    model = routeModel(input.model);
  } catch (err) {
    model = { model: '', requirement: sensitivity === 'sensitive' ? 'local-required' : 'default', reason: 'model-routing-failed' };
    violations.push({ kind: 'model', reason: (err as Error).message });
  }

  if (sensitivity === 'sensitive' && model.requirement !== 'local-required') {
    violations.push({ kind: 'model', reason: 'Sensitive mode requires local model routing.' });
  }

  const guardDecisions = (input.guards ?? []).map((request) => decideGuard({
    ...request,
    sensitiveMode: sensitivity === 'sensitive' || request.sensitiveMode,
  }));

  for (const decision of guardDecisions) {
    if (decision.disposition === 'deny') {
      violations.push({ kind: 'tool', reason: decision.reason, decision });
    }
  }

  return { model, guardDecisions, violations, allowed: violations.length === 0 };
}
