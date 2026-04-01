import type { Message, ToolDefinition } from '../llm/types.js';
import type { Brain } from '../memory/brain.js';
import { estimateTokens, createBudget } from './budget.js';

export interface PromptSection {
  name: string;
  content: string;
  tokens: number;
  priority: number;
}

export interface AssembledPrompt {
  systemMessage: string;
  messages: Message[];
  tools: ToolDefinition[];
  tokenEstimate: {
    system: number;
    history: number;
    total: number;
  };
}

export interface AssembleOptions {
  brain: Brain;
  history: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 8000;

/** Builds the identity section from brain's system prompt sections. */
export function buildIdentitySection(brain: Brain): PromptSection {
  const content = brain.getSystemPromptSections().join('\n\n');
  return {
    name: 'identity',
    content,
    tokens: estimateTokens(content),
    priority: 100,
  };
}

/** Builds the tools section from tool definitions. */
export function buildToolsSection(tools: ToolDefinition[]): PromptSection {
  if (tools.length === 0) {
    return { name: 'tools', content: '', tokens: 0, priority: 80 };
  }

  const lines = tools.map(
    (t) => `- ${t.name}: ${t.description}`,
  );
  const content = `You have tools available. Use them when the user asks you to interact with the filesystem, run commands, or remember things. Call tools directly — don't tell the user to do things themselves.\n\nAvailable tools:\n${lines.join('\n')}`;

  return {
    name: 'tools',
    content,
    tokens: estimateTokens(content),
    priority: 80,
  };
}

/**
 * Assembles the complete prompt.
 * - Builds sections, fits within system budget (highest priority first)
 * - Trims history to fit history budget (keeps most recent messages)
 */
export function assemblePrompt(options: AssembleOptions): AssembledPrompt {
  const { brain, history, tools = [], maxTokens = DEFAULT_MAX_TOKENS } = options;
  const budget = createBudget(maxTokens);

  // Build and sort sections by priority (highest first)
  const sections: PromptSection[] = [
    buildIdentitySection(brain),
    buildToolsSection(tools),
  ].sort((a, b) => b.priority - a.priority);

  // Fit sections within system budget
  const includedSections: PromptSection[] = [];
  let systemTokens = 0;

  for (const section of sections) {
    if (section.content === '') continue;
    if (systemTokens + section.tokens <= budget.reserved.system) {
      includedSections.push(section);
      systemTokens += section.tokens;
    }
  }

  const systemMessage = includedSections
    .map((s) => s.content)
    .join('\n\n');

  // Trim history to fit history budget (keep most recent)
  const fittedMessages: Message[] = [];
  let historyTokens = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const msgTokens = estimateTokens(msg.content);
    if (historyTokens + msgTokens > budget.reserved.history) break;
    fittedMessages.unshift(msg);
    historyTokens += msgTokens;
  }

  return {
    systemMessage,
    messages: fittedMessages,
    tools,
    tokenEstimate: {
      system: systemTokens,
      history: historyTokens,
      total: systemTokens + historyTokens,
    },
  };
}
