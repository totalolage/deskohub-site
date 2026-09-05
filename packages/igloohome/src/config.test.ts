import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  IgloohomeRuntimeConfigSchema,
  igloohomeApiTimeoutMaximumMilliseconds,
} from "./config";

const decode = Schema.decodeUnknownSync(IgloohomeRuntimeConfigSchema);

const configWith = (apiTimeout: number) => ({
  apiUrl: "https://api.example.test/igloohome",
  authUrl: "https://auth.example.test",
  clientId: "client-id",
  clientSecret: "client-secret",
  apiTimeout,
});

describe("IgloohomeRuntimeConfigSchema", () => {
  test("accepts the configured default and the shared per-request maximum", () => {
    expect(decode(configWith(10_000)).apiTimeout).toBe(10_000);
    expect(
      decode(configWith(igloohomeApiTimeoutMaximumMilliseconds)).apiTimeout
    ).toBe(igloohomeApiTimeoutMaximumMilliseconds);
  });

  test("rejects non-positive and above-maximum per-request timeouts", () => {
    expect(() => decode(configWith(0))).toThrow();
    expect(() =>
      decode(configWith(igloohomeApiTimeoutMaximumMilliseconds + 1))
    ).toThrow();
  });
});
