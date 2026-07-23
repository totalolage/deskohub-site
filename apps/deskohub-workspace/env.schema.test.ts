import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  postHogFeatureFlagOverrideEnvironmentSchema,
  workspaceClientEnvSchema,
  workspaceServerEnvSchema,
} from "./env.schema";

describe("workspace environment schemas", () => {
  test("decodes defaults and numeric environment values", () => {
    const decodeTimeout = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.DOTYPOS_API_TIMEOUT
    );
    const decodeServiceName = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.POSTHOG_SERVICE_NAME
    );

    expect(decodeTimeout(undefined)).toBe(5_000);
    expect(decodeTimeout("2500")).toBe(2_500);
    expect(decodeServiceName(undefined)).toBe("deskohub-workspace");
    expect(() => decodeTimeout("1.5")).toThrow();
    expect(() => decodeTimeout("0")).toThrow();
  });

  test("validates URLs without changing their string representation", () => {
    const decodeDatabaseUrl = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.DATABASE_URL
    );
    const decodePostHogHost = Schema.decodeUnknownSync(
      workspaceClientEnvSchema.fields.NEXT_PUBLIC_POSTHOG_HOST
    );
    const databaseUrl = "postgres://user:pass@localhost:5432/workspace";

    expect(decodeDatabaseUrl(databaseUrl)).toBe(databaseUrl);
    expect(decodePostHogHost(undefined)).toBeUndefined();
    expect(() => decodeDatabaseUrl("not a URL")).toThrow();
  });

  test("exposes fields through Standard Schema for T3 Env", async () => {
    const result =
      await workspaceServerEnvSchema.fields.DOTYPOS_API_TIMEOUT[
        "~standard"
      ].validate(undefined);

    expect(result).toEqual({ value: 5_000 });
  });

  test("validates Vercel's standard public environment", () => {
    const decodeVercelEnvironment = Schema.decodeUnknownSync(
      workspaceClientEnvSchema.fields.NEXT_PUBLIC_VERCEL_ENV
    );

    expect(decodeVercelEnvironment(undefined)).toBeUndefined();
    expect(decodeVercelEnvironment("development")).toBe("development");
    expect(decodeVercelEnvironment("preview")).toBe("preview");
    expect(decodeVercelEnvironment("production")).toBe("production");
    expect(() => decodeVercelEnvironment("staging")).toThrow();
  });

  test("decodes deployment-scoped PostHog feature flag overrides", () => {
    const decode = Schema.decodeUnknownSync(
      postHogFeatureFlagOverrideEnvironmentSchema
    );

    expect(
      decode({
        POSTHOG_FEATURE_FLAG_OVERRIDES: undefined,
        VERCEL_ENV: "preview",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toBeUndefined();
    expect(
      decode({
        POSTHOG_FEATURE_FLAG_OVERRIDES: "",
        VERCEL_ENV: "preview",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toBeUndefined();
    expect(
      decode({
        POSTHOG_FEATURE_FLAG_OVERRIDES: "{}",
        VERCEL_ENV: "preview",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toBeUndefined();
    expect(
      decode({
        POSTHOG_FEATURE_FLAG_OVERRIDES: '{"discount_codes":false}',
        VERCEL_ENV: "development",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toEqual({ discount_codes: false });
    expect(
      decode({
        POSTHOG_FEATURE_FLAG_OVERRIDES:
          '{"calendar_sales":true,"customer_discounts":false,"discount_codes":true}',
        VERCEL_ENV: "preview",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toEqual({
      calendar_sales: true,
      customer_discounts: false,
      discount_codes: true,
    });
  });

  test.each([
    ["malformed JSON", "{"],
    ["an array", "[]"],
    ["a primitive", "true"],
    ["null", "null"],
    ["an unknown key", '{"seasonal_menu":true}'],
    ["a non-boolean value", '{"discount_codes":"treatment"}'],
  ])("rejects %s as PostHog feature flag overrides", (_case, overrides) => {
    const decode = Schema.decodeUnknownSync(
      postHogFeatureFlagOverrideEnvironmentSchema
    );

    expect(() =>
      decode({
        POSTHOG_FEATURE_FLAG_OVERRIDES: overrides,
        VERCEL_ENV: "preview",
      })
    ).toThrow();
  });

  test("accepts non-empty overrides only outside production", () => {
    const decode = Schema.decodeUnknownSync(
      postHogFeatureFlagOverrideEnvironmentSchema
    );
    const overrides = '{"discount_codes":true}';

    expect(
      decode({
        POSTHOG_FEATURE_FLAG_OVERRIDES: overrides,
        VERCEL_ENV: "preview",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toEqual({ discount_codes: true });
    expect(
      decode({
        POSTHOG_FEATURE_FLAG_OVERRIDES: overrides,
        VERCEL_ENV: "development",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toEqual({ discount_codes: true });
    expect(() =>
      decode({
        POSTHOG_FEATURE_FLAG_OVERRIDES: overrides,
        VERCEL_ENV: "production",
      })
    ).toThrow();
    expect(
      decode({
        POSTHOG_FEATURE_FLAG_OVERRIDES: "{}",
        VERCEL_ENV: "production",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toBeUndefined();
  });
});
