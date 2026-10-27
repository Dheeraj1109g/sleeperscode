/**
 * Truncates text to a specified maximum character count, appending an ellipsis if trimmed.
 */
export function truncate(text: string, maxLength = 50, ellipsis = "..."): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength)}${ellipsis}`;
}

/**
 * Strips ANSI escape codes (colors, cursor movements, OSC sequences) from text.
 * Useful for parsing or rendering raw terminal and CLI output.
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?(?:\x07|\x1b\\)/g, "");
}

/**
 * Converts a string into a clean, filesystem- and URL-safe slug.
 * Transforms whitespace and punctuation into single hyphens, lowercases, and strips leading/trailing hyphens.
 */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Capitalizes the first character of a string while preserving the rest.
 */
export function capitalize(text: string): string {
  if (text.length === 0) {
    return "";
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Formats a count with proper noun inflection.
 *
 * @example
 * pluralize(1, "thread") // "1 thread"
 * pluralize(4, "thread") // "4 threads"
 * pluralize(2, "process", "processes") // "2 processes"
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  const noun = count === 1 ? singular : (plural ?? `${singular}s`);
  return `${count} ${noun}`;
}
