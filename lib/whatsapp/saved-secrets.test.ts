import { describe, expect, it } from "vitest";
import { parseSecretInput, secretSource } from "./saved-secrets";

describe("parseSecretInput", () => {
  it("trims a valid secret", () => {
    expect(parseSecretInput("  abc123def456  ")).toEqual({ ok: true, value: "abc123def456" });
  });

  it("treats null as removing the saved secret", () => {
    expect(parseSecretInput(null)).toEqual({ ok: true, value: null });
  });

  it("rejects empty, spaced, oversized and non-string values", () => {
    expect(parseSecretInput("   ").ok).toBe(false);
    expect(parseSecretInput("two words").ok).toBe(false);
    expect(parseSecretInput("x".repeat(257)).ok).toBe(false);
    expect(parseSecretInput(42).ok).toBe(false);
    expect(parseSecretInput(undefined).ok).toBe(false);
  });
});

describe("secretSource", () => {
  it("prefers the value saved in Settings over the environment", () => {
    expect(secretSource("encrypted", "env-value")).toBe("settings");
    expect(secretSource(null, "env-value")).toBe("env");
    expect(secretSource(null, undefined)).toBe("none");
  });
});
