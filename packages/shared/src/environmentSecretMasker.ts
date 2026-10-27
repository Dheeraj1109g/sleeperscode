/**
 * High-Performance Secret Masker and Credential Sanitizer.
 *
 * Scans strings, logs, and command outputs to detect and redact sensitive credentials
 * (OpenAI/Anthropic/Google API keys, GitHub tokens, AWS keys, JWTs, private keys)
 * before terminal rendering, telemetry emission, or persistent logging.
 *
 * @module environmentSecretMasker
 */

export interface SecretPatternDefinition {
  readonly id: string;
  readonly name: string;
  readonly regex: RegExp;
  readonly replacement?: string;
}

export interface MaskResult {
  readonly sanitizedText: string;
  readonly redactedCount: number;
  readonly matchedRules: readonly string[];
}

export const KNOWN_SECRET_PATTERNS: readonly SecretPatternDefinition[] = [
  // Private Key Blocks
  {
    id: "private-key-block",
    name: "PEM Private Key Block",
    regex: /-----BEGIN[ A-Z0-9_-]+PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]+PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  // Anthropic API Key (must precede generic sk- keys)
  {
    id: "anthropic-api-key",
    name: "Anthropic API Key",
    regex: /\bsk-ant-[a-zA-Z0-9_-]{20,100}\b/g,
    replacement: "[REDACTED_ANTHROPIC_KEY]",
  },
  // OpenAI API Key
  {
    id: "openai-api-key",
    name: "OpenAI Secret Key",
    regex: /\bsk-(?!ant-)[a-zA-Z0-9_-]{20,64}\b/g,
    replacement: "[REDACTED_OPENAI_KEY]",
  },
  // Google Gemini API Key
  {
    id: "gemini-api-key",
    name: "Google Gemini API Key",
    regex: /\bAIza[0-9A-Za-z-_]{35}\b/g,
    replacement: "[REDACTED_GEMINI_KEY]",
  },
  // GitHub Personal Access Token / OAuth
  {
    id: "github-pat",
    name: "GitHub Access Token",
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,255}\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  // AWS Access Key ID
  {
    id: "aws-access-key-id",
    name: "AWS Access Key ID",
    regex: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: "[REDACTED_AWS_KEY_ID]",
  },
  // JSON Web Token (JWT)
  {
    id: "jwt-token",
    name: "JSON Web Token",
    regex: /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
    replacement: "[REDACTED_JWT]",
  },
  // Generic password in URLs (e.g. postgres://user:password@host)
  {
    id: "uri-credentials",
    name: "URI User/Password Credential",
    regex: /([a-zA-Z]+:\/\/[^:]+:)([^@]+)(@)/g,
    replacement: "$1[REDACTED_PASSWORD]$3",
  },
];

/**
 * Sanitizes input text by replacing detected credentials with redacted tokens.
 */
export function maskSensitiveSecrets(
  rawText: string,
  customRules: readonly SecretPatternDefinition[] = [],
): MaskResult {
  if (!rawText) {
    return { sanitizedText: "", redactedCount: 0, matchedRules: [] };
  }

  const allRules = [...KNOWN_SECRET_PATTERNS, ...customRules];
  let sanitized = rawText;
  let redactedCount = 0;
  const matchedRules = new Set<string>();

  for (const rule of allRules) {
    // Reset regex state if global
    rule.regex.lastIndex = 0;
    const matches = sanitized.match(rule.regex);
    if (matches && matches.length > 0) {
      redactedCount += matches.length;
      matchedRules.add(rule.id);
      const rep = rule.replacement ?? "[REDACTED_SECRET]";
      sanitized = sanitized.replace(rule.regex, rep);
    }
  }

  return {
    sanitizedText: sanitized,
    redactedCount,
    matchedRules: Array.from(matchedRules),
  };
}

/**
 * Checks whether text contains any high-confidence secret credentials without modifying it.
 */
export function containsSecrets(
  text: string,
  customRules: readonly SecretPatternDefinition[] = [],
): boolean {
  if (!text) return false;
  const allRules = [...KNOWN_SECRET_PATTERNS, ...customRules];
  for (const rule of allRules) {
    rule.regex.lastIndex = 0;
    if (rule.regex.test(text)) return true;
  }
  return false;
}
