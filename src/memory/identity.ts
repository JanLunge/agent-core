import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface IdentityContent {
  personality: string | undefined;
  knowsAbout: string[];
}

export function loadIdentityFiles(
  personality: string | undefined,
  knowsAbout: string[],
  baseDir: string,
): IdentityContent {
  let personalityText: string | undefined;
  if (personality) {
    const p = resolve(baseDir, personality);
    if (existsSync(p)) personalityText = readFileSync(p, 'utf-8').trim();
  }

  const loaded: string[] = [];
  for (const path of knowsAbout) {
    const p = resolve(baseDir, path);
    if (existsSync(p)) loaded.push(readFileSync(p, 'utf-8').trim());
  }

  return { personality: personalityText, knowsAbout: loaded };
}
