import stripAnsi from 'strip-ansi';

/**
 * Maximum message length for Telegram
 */
const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Maximum length for code blocks (leave room for formatting)
 */
const CODE_BLOCK_MAX_LENGTH = TELEGRAM_MAX_LENGTH - 20;

/**
 * Clean terminal output for chat display
 * Removes ANSI escape codes and cleans up formatting
 */
export function cleanOutput(text: string): string {
  // Strip ANSI codes
  let cleaned = stripAnsi(text);

  // Remove carriage returns and normalize line endings
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '');

  // Remove excessive blank lines (more than 2 in a row)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Trim trailing whitespace from each line
  cleaned = cleaned
    .split('\n')
    .map((line: string) => line.trimEnd())
    .join('\n');

  return cleaned.trim();
}

/**
 * Chunk a long message into smaller pieces for Telegram
 * Tries to split at natural boundaries (newlines, sentences)
 */
export function chunkMessage(text: string, maxLength: number = CODE_BLOCK_MAX_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to find a good break point
    let breakPoint = maxLength;

    // Look for newline near the end
    const lastNewline = remaining.lastIndexOf('\n', maxLength);
    if (lastNewline > maxLength * 0.5) {
      breakPoint = lastNewline + 1;
    } else {
      // Look for sentence end
      const lastPeriod = remaining.lastIndexOf('. ', maxLength);
      if (lastPeriod > maxLength * 0.5) {
        breakPoint = lastPeriod + 2;
      } else {
        // Look for space
        const lastSpace = remaining.lastIndexOf(' ', maxLength);
        if (lastSpace > maxLength * 0.5) {
          breakPoint = lastSpace + 1;
        }
      }
    }

    chunks.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }

  return chunks;
}

/**
 * Format output for Telegram with optional code block
 */
export function formatForTelegram(
  text: string,
  options: { codeBlock?: boolean; language?: string } = {}
): string[] {
  const cleaned = cleanOutput(text);

  if (options.codeBlock) {
    const lang = options.language || '';
    const wrapped = `\`\`\`${lang}\n${cleaned}\n\`\`\``;

    if (wrapped.length <= TELEGRAM_MAX_LENGTH) {
      return [wrapped];
    }

    // Need to chunk - wrap each chunk in code block
    const innerMaxLength = CODE_BLOCK_MAX_LENGTH - lang.length - 10;
    return chunkMessage(cleaned, innerMaxLength).map(
      (chunk, i, arr) =>
        `\`\`\`${lang}\n${chunk}\n\`\`\`${arr.length > 1 ? ` (${i + 1}/${arr.length})` : ''}`
    );
  }

  return chunkMessage(cleaned, TELEGRAM_MAX_LENGTH);
}

/**
 * Detect if output contains a confirmation prompt
 */
export function detectConfirmationPrompt(text: string): boolean {
  const patterns = [
    /\[y\/n\]/i,
    /\(y\/n\)/i,
    /confirm\?/i,
    /proceed\?/i,
    /continue\?/i,
    /are you sure\?/i,
    /\[yes\/no\]/i,
  ];

  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Extract the last meaningful line from output (for prompt detection)
 */
export function getLastLine(text: string): string {
  const lines = text.split('\n').filter((line) => line.trim());
  return lines[lines.length - 1] || '';
}
