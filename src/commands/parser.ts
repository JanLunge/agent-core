export interface ParsedCommand {
  name: string;
  args: string;
}

/**
 * Parses a slash command from user input.
 * Returns null if the text is not a command (doesn't start with `/`).
 */
export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) {
    return { name: trimmed.slice(1), args: '' };
  }

  return {
    name: trimmed.slice(1, spaceIndex),
    args: trimmed.slice(spaceIndex + 1).trim(),
  };
}
