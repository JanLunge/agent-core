/**
 * Telegram MarkdownV2 formatting helpers.
 */

const MARKDOWN_V2_SPECIAL = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

/**
 * Escapes all MarkdownV2 special characters so the text is rendered literally.
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(MARKDOWN_V2_SPECIAL, '\\$1');
}

/**
 * Splits text into chunks that fit within Telegram's message size limit.
 * Tries to split at line breaks; falls back to hard splits when a single
 * line exceeds maxLength.
 */
export function splitMessage(text: string, maxLength = 4096): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find a line-break to split at
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt <= 0) {
      // No good line break — hard split
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }

  return chunks;
}
