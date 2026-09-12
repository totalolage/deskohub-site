import { describe, expect, test } from "bun:test";
import { parseBetterAuthSecrets } from "./auth-secrets";

describe("Better Auth secrets parsing", () => {
  const strongSecret = "9tEWbGQfP2vXcK7mRz4sLh6yUnAoJd1e";

  test("accepts a single current secret", () => {
    const result = parseBetterAuthSecrets(`1:${strongSecret}`);

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.secrets).toEqual([{ version: 1, value: strongSecret }]);
    }
  });

  test("orders rotation entries so the first entry stays current", () => {
    const rotatedSecret = "Qw7eNb2mVzYr8sKx4tLp6hUcJoAd5gRf";
    const result = parseBetterAuthSecrets(
      `3:${rotatedSecret}, 1:${strongSecret}`
    );

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.secrets).toEqual([
        { version: 3, value: rotatedSecret },
        { version: 1, value: strongSecret },
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

  test("rejects entries shorter than the 32-character strength minimum", () => {
    const result = parseBetterAuthSecrets("1:short-secret-value");

    expect(result).toEqual({
      kind: "invalid",
      message: "BETTER_AUTH_SECRETS has a weak secret value.",
    });
  });

  test("rejects obviously low-entropy repeated values", () => {
    const repeatedByte = Buffer.alloc(48, 11).toString("base64url");
    const repeatedCharacter = "a".repeat(48);
    const repeatedUnit = "secret-unit".repeat(5);

    for (const value of [repeatedByte, repeatedCharacter, repeatedUnit]) {
      const result = parseBetterAuthSecrets(`1:${value}`);
      expect(result).toEqual({
        kind: "invalid",
        message: "BETTER_AUTH_SECRETS has a weak secret value.",
      });
    }
  });

  test("accepts high-entropy values of at least 32 characters without echoing them", () => {
    const value = "9tEWbGQfP2vXcK7mRz4sLh6yUnAoJd1e";
    const result = parseBetterAuthSecrets(`1:${value},2:${value}-rotated`);

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.secrets[0]?.value).toBe(value);
    }

    const weak = parseBetterAuthSecrets("1:9tEWbGQfP2vX");
    if (weak.kind === "invalid") {
      expect(weak.message).not.toContain("9tEWbGQfP2vX");
    }
  });
});
