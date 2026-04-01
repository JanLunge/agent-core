import type { ToolDefinition } from '../llm/types.js';

export interface ToolContext {
  agentName: string;
  conversationId: string;
  baseDir: string;
  brain?: import('../memory/brain.js').Brain;
  identityStore?: import('../memory/identity-store.js').IdentityStore;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Promise<string>;

export interface ToolEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools = new Map<string, ToolEntry>();

  register(
    name: string,
    description: string,
    parameters: Record<string, unknown>,
    handler: ToolHandler,
  ): void {
    this.tools.set(name, {
      definition: { name, description, parameters },
      handler,
    });
  }

  get(name: string): ToolEntry | undefined {
    return this.tools.get(name);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((entry) => entry.definition);
  }

  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  names(): string[] {
    return Array.from(this.tools.keys());
  }
}
