import { describe, expect, it } from "vitest";
import {
  containsSecrets,
  KNOWN_SECRET_PATTERNS,
  maskSensitiveSecrets,
  type SecretPatternDefinition,
} from "./environmentSecretMasker";

describe("environmentSecretMasker", () => {
  it("should return empty result when given empty string", () => {
    const res = maskSensitiveSecrets("");
    expect(res.sanitizedText).toBe("");
    expect(res.redactedCount).toBe(0);
    expect(res.matchedRules).toEqual([]);
    expect(containsSecrets("")).toBe(false);
  });

  it("should mask OpenAI API keys", () => {
    const raw = "Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz1234567890 in header";
    const res = maskSensitiveSecrets(raw);
    expect(res.sanitizedText).toContain("[REDACTED_OPENAI_KEY]");
    expect(res.sanitizedText).not.toContain("sk-abcdefghijklmnopqrstuvwxyz1234567890");
    expect(res.redactedCount).toBe(1);
    expect(res.matchedRules).toContain("openai-api-key");
    expect(containsSecrets(raw)).toBe(true);
  });

  it("should mask Anthropic API keys", () => {
    const raw = "export ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
    const res = maskSensitiveSecrets(raw);
    expect(res.sanitizedText).toContain("[REDACTED_ANTHROPIC_KEY]");
    expect(res.sanitizedText).not.toContain("sk-ant-api03");
    expect(res.matchedRules).toContain("anthropic-api-key");
    expect(containsSecrets(raw)).toBe(true);
  });

  it("should mask Google Gemini API keys", () => {
    const raw =
      "curl https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";
    const res = maskSensitiveSecrets(raw);
    expect(res.sanitizedText).toContain("[REDACTED_GEMINI_KEY]");
    expect(res.sanitizedText).not.toContain("AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q");
    expect(res.matchedRules).toContain("gemini-api-key");
  });

  it("should mask GitHub personal access tokens", () => {
    const raw =
      "git clone https://ghp_0123456789abcdefghijklmnopqrstuvwxyzAB@github.com/org/repo.git";
    const res = maskSensitiveSecrets(raw);
    expect(res.sanitizedText).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(res.sanitizedText).not.toContain("ghp_0123456789abcdefghijklmnopqrstuvwxyzAB");
    expect(res.matchedRules).toContain("github-pat");
  });

  it("should mask AWS Access Key IDs", () => {
    const raw = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    const res = maskSensitiveSecrets(raw);
    expect(res.sanitizedText).toContain("[REDACTED_AWS_KEY_ID]");
    expect(res.sanitizedText).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(res.matchedRules).toContain("aws-access-key-id");
  });

  it("should mask PEM RSA private key blocks", () => {
    const pem = `
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y1+dummyKeyDataForTestingPurposesOnly+fake
MIIEowIBAAKCAQEA0Y1+dummyKeyDataForTestingPurposesOnly+fake
-----END RSA PRIVATE KEY-----
`;
    const res = maskSensitiveSecrets(pem);
    expect(res.sanitizedText).toContain("[REDACTED_PRIVATE_KEY]");
    expect(res.sanitizedText).not.toContain("dummyKeyDataForTestingPurposesOnly");
    expect(res.matchedRules).toContain("private-key-block");
  });

  it("should mask JSON Web Tokens (JWT)", () => {
    const token =
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const res = maskSensitiveSecrets(token);
    expect(res.sanitizedText).toContain("[REDACTED_JWT]");
    expect(res.sanitizedText).not.toContain("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
    expect(res.matchedRules).toContain("jwt-token");
  });

  it("should mask embedded credentials in database URIs", () => {
    const uri = "postgres://admin:superSecretPassword123@db.internal.net:5432/production";
    const res = maskSensitiveSecrets(uri);
    expect(res.sanitizedText).toBe(
      "postgres://admin:[REDACTED_PASSWORD]@db.internal.net:5432/production",
    );
    expect(res.matchedRules).toContain("uri-credentials");
  });

  it("should support custom redaction rules", () => {
    const customRule: SecretPatternDefinition = {
      id: "corp-auth-token",
      name: "Corporate Internal Auth Token",
      regex: /\bCORP_AUTH_[a-zA-Z0-9]{24,48}\b/g,
      replacement: "[REDACTED_CORP_TOKEN]",
    };

    const text = "Connecting to backend with CORP_AUTH_9876543210abcdef98765432 in header";
    const res = maskSensitiveSecrets(text, [customRule]);
    expect(res.sanitizedText).toContain("[REDACTED_CORP_TOKEN]");
    expect(res.matchedRules).toContain("corp-auth-token");
    expect(containsSecrets(text, [customRule])).toBe(true);
  });

  it("should return unchanged text and false when no secrets are present", () => {
    const cleanText = "Building packages/shared in 45ms. All 42 tests passed.";
    const res = maskSensitiveSecrets(cleanText);
    expect(res.sanitizedText).toBe(cleanText);
    expect(res.redactedCount).toBe(0);
    expect(res.matchedRules).toEqual([]);
    expect(containsSecrets(cleanText)).toBe(false);
  });
});
