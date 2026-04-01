import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ToolRegistry, ToolHandler } from '../tools/registry.js';

export interface ToolRegistration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: ToolHandler;
}

export interface SkillExport {
  name: string;
  description: string;
  commands?: string[];
  tools?: ToolRegistration[];
  onLoad?: (context: { skillsDir: string; registry: ToolRegistry }) => void;
}

export interface SkillManifest {
  name: string;
  description: string;
  commands: string[];
  tools: string[];
  enabled: boolean;
  filePath: string;
}

interface LoadedSkill {
  manifest: SkillManifest;
  toolNames: string[];
}

export class SkillLoader {
  private skillsDir: string;
  private registry: ToolRegistry;
  private loaded = new Map<string, LoadedSkill>();

  constructor(opts: { skillsDir: string; registry: ToolRegistry }) {
    this.skillsDir = resolve(opts.skillsDir);
    this.registry = opts.registry;
  }

  async loadAll(): Promise<SkillManifest[]> {
    let entries: string[];
    try {
      const dirEntries = await readdir(this.skillsDir);
      entries = dirEntries.filter(
        (f) => f.endsWith('.js') || f.endsWith('.ts'),
      );
    } catch {
      return [];
    }

    const manifests: SkillManifest[] = [];
    for (const entry of entries) {
      try {
        const manifest = await this.load(join(this.skillsDir, entry));
        manifests.push(manifest);
      } catch (err) {
        console.error(`Failed to load skill ${entry}:`, err);
      }
    }
    return manifests;
  }

  async load(filePath: string): Promise<SkillManifest> {
    const absPath = resolve(filePath);
    const mod = (await import(absPath)) as { default?: SkillExport } & SkillExport;
    const skill: SkillExport = mod.default ?? mod;

    if (!skill.name || !skill.description) {
      throw new Error(`Skill at ${absPath} must export name and description`);
    }

    // If already loaded, unload first
    if (this.loaded.has(skill.name)) {
      this.unload(skill.name);
    }

    const toolNames: string[] = [];

    if (skill.tools) {
      for (const tool of skill.tools) {
        this.registry.register(tool.name, tool.description, tool.parameters, tool.handler);
        toolNames.push(tool.name);
      }
    }

    if (skill.onLoad) {
      skill.onLoad({ skillsDir: this.skillsDir, registry: this.registry });
    }

    const manifest: SkillManifest = {
      name: skill.name,
      description: skill.description,
      commands: skill.commands ?? [],
      tools: toolNames,
      enabled: true,
      filePath: absPath,
    };

    this.loaded.set(skill.name, { manifest, toolNames });
    return manifest;
  }

  unload(name: string): void {
    const skill = this.loaded.get(name);
    if (!skill) return;

    for (const toolName of skill.toolNames) {
      this.registry.remove(toolName);
    }

    this.loaded.delete(name);
  }

  list(): SkillManifest[] {
    return Array.from(this.loaded.values()).map((s) => ({ ...s.manifest }));
  }

  enable(name: string): void {
    const skill = this.loaded.get(name);
    if (!skill) throw new Error(`Skill "${name}" is not loaded`);
    skill.manifest.enabled = true;
  }

  disable(name: string): void {
    const skill = this.loaded.get(name);
    if (!skill) throw new Error(`Skill "${name}" is not loaded`);
    skill.manifest.enabled = false;
  }
}
