import { describe, expect, test } from "bun:test";
import { parseBetterAuthSecrets } from "./auth-secrets";

describe("Better Auth secrets parsing", () => {
  test("accepts a single current secret", () => {
    const result = parseBetterAuthSecrets("1:first-secret-value");

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.secrets).toEqual([
        { version: 1, value: "first-secret-value" },
      ]);
    }
  });

  test("orders rotation entries so the first entry stays current", () => {
    const result = parseBetterAuthSecrets("3:third-secret, 1:first-secret");

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.secrets).toEqual([
        { version: 3, value: "third-secret" },
        { version: 1, value: "first-secret" },
      ]);
    }
  });

  test("fails closed when the configuration is absent or blank", () => {
    expect(parseBetterAuthSecrets(undefined)).toEqual({
      kind: "invalid",
      message: "BETTER_AUTH_SECRETS is not configured.",
    });
    expect(parseBetterAuthSecrets("   ")).toEqual({
      kind: "invalid",
      message: "BETTER_AUTH_SECRETS is not configured.",
    });
  });

  test("fails closed without echoing values on malformed entries", () => {
    const message = (raw: string) => {
      const result = parseBetterAuthSecrets(raw);
      return result.kind === "invalid" ? result.message : "parsed";
    };

    expect(message("first-secret-without-version")).toBe(
      "BETTER_AUTH_SECRETS has an invalid entry format."
    );
    expect(message("1:")).toBe(
      "BETTER_AUTH_SECRETS has an invalid entry format."
    );
    expect(message("0:some-secret")).toBe(
      "BETTER_AUTH_SECRETS has an invalid entry format."
    );
    expect(message("1:secret,2:")).toBe(
      "BETTER_AUTH_SECRETS has an invalid entry format."
    );
    expect(message("1:secret,1:secret-again")).toBe(
      "BETTER_AUTH_SECRETS has duplicate versions."
    );
    expect(message("1:secret,1:secret-again,leaked-value")).not.toContain(
      "leaked"
    );
  });
});
