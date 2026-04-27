export type ModelSensitivity = 'normal' | 'sensitive';
export type TaskComplexity = 'low' | 'medium' | 'high';
export type ModelCapability = 'local' | 'remote' | 'strong';

export interface AvailableModel {
  id: string;
  capabilities: ModelCapability[];
  personas?: string[];
}

export interface PersonaModelDefaults {
  defaultModel?: string;
  strongModel?: string;
  localModel?: string;
}

export interface ModelRoutingPolicy {
  defaultModel: string;
  strongModel?: string;
  localModel?: string;
  personaDefaults?: Record<string, PersonaModelDefaults>;
}

export interface ModelRoutingInput {
  taskType: string;
  persona?: string;
  sensitivity: ModelSensitivity;
  complexity: TaskComplexity;
  availableModels: AvailableModel[];
  policy: ModelRoutingPolicy;
}

export interface ModelRoutingDecision {
  model: string;
  requirement: 'local-required' | 'strong-preferred' | 'default';
  reason: string;
}

/**
 * Deterministic model routing boundary.
 *
 * This only selects from already-available model ids and never performs remote
 * probing. Sensitive work must use a local-capable model; complex non-sensitive
 * work may prefer a stronger remote model; persona defaults override global
 * defaults when available.
 */
export function routeModel(input: ModelRoutingInput): ModelRoutingDecision {
  const persona = input.persona ? normalizeName(input.persona) : undefined;
  const personaDefaults = persona ? input.policy.personaDefaults?.[persona] : undefined;

  if (input.sensitivity === 'sensitive') {
    const requested = personaDefaults?.localModel ?? input.policy.localModel;
    const model = chooseAvailable(input.availableModels, requested, (candidate) => candidate.capabilities.includes('local'));
    if (!model) {
      throw new Error('Sensitive task requires a local model, but no local-capable model is available');
    }
    return { model: model.id, requirement: 'local-required', reason: 'sensitive-task-local-required' };
  }

  if (input.complexity === 'high') {
    const requested = personaDefaults?.strongModel ?? input.policy.strongModel;
    const model = chooseAvailable(input.availableModels, requested, (candidate) => candidate.capabilities.includes('strong'));
    if (model) {
      return { model: model.id, requirement: 'strong-preferred', reason: 'high-complexity-strong-model' };
    }
  }

  const requested = personaDefaults?.defaultModel ?? input.policy.defaultModel;
  const model = chooseAvailable(input.availableModels, requested, (candidate) => candidate.capabilities.includes('remote') || candidate.capabilities.includes('local'));
  if (!model) throw new Error(`Default model is not available: ${requested}`);
  return { model: model.id, requirement: 'default', reason: personaDefaults?.defaultModel ? 'persona-default' : 'policy-default' };
}

function chooseAvailable(
  availableModels: AvailableModel[],
  requested: string | undefined,
  predicate: (candidate: AvailableModel) => boolean,
): AvailableModel | undefined {
  if (requested) {
    const exact = availableModels.find((candidate) => candidate.id === requested && predicate(candidate));
    if (exact) return exact;
  }
  return availableModels.find(predicate);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
