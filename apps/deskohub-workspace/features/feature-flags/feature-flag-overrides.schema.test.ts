import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { postHogFeatureFlagOverrideEnvironmentSchema } from "./feature-flag-overrides.schema";

const decodeFeatureFlagOverrideEnvironment = Schema.decodeUnknownSync(
  postHogFeatureFlagOverrideEnvironmentSchema
);

describe("PostHog feature flag override environment schema", () => {
  test("decodes deployment-scoped PostHog feature flag overrides", () => {
    expect(
      decodeFeatureFlagOverrideEnvironment({
        POSTHOG_FEATURE_FLAG_OVERRIDES: undefined,
        VERCEL_ENV: "preview",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toBeUndefined();
    expect(
      decodeFeatureFlagOverrideEnvironment({
        POSTHOG_FEATURE_FLAG_OVERRIDES: "",
        VERCEL_ENV: "preview",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toBeUndefined();
    expect(
      decodeFeatureFlagOverrideEnvironment({
        POSTHOG_FEATURE_FLAG_OVERRIDES: "{}",
        VERCEL_ENV: "preview",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toBeUndefined();
    expect(
      decodeFeatureFlagOverrideEnvironment({
        POSTHOG_FEATURE_FLAG_OVERRIDES: '{"discount_codes":false}',
        VERCEL_ENV: "development",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toEqual({ discount_codes: false });
    expect(
      decodeFeatureFlagOverrideEnvironment({
        POSTHOG_FEATURE_FLAG_OVERRIDES:
          '{"calendar_sales":true,"customer_discounts":false,"discount_codes":true,"office_page":true}',
        VERCEL_ENV: "preview",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toEqual({
      calendar_sales: true,
      customer_discounts: false,
      discount_codes: true,
      office_page: true,
    });
  });

  test("defers unknown keys and their unvalidated values to the contract resolver outside production", () => {
    for (const VERCEL_ENV of ["preview", "development"] as const) {
      expect(
        decodeFeatureFlagOverrideEnvironment({
          POSTHOG_FEATURE_FLAG_OVERRIDES:
            '{"discount_codes":true,"loyalty_points":true,"seasonal_menu":"synthetic-variant"}',
          VERCEL_ENV,
        }).POSTHOG_FEATURE_FLAG_OVERRIDES
      ).toEqual({
        discount_codes: true,
        loyalty_points: true,
        seasonal_menu: "synthetic-variant",
      });
    }
  });

  test("rejects a known key with a non-boolean value in every deployment", () => {
    for (const VERCEL_ENV of [
      "production",
      "preview",
      "development",
    ] as const) {
      expect(() =>
        decodeFeatureFlagOverrideEnvironment({
          POSTHOG_FEATURE_FLAG_OVERRIDES: '{"discount_codes":"treatment"}',
          VERCEL_ENV,
        })
      ).toThrow();
    }
  });

  test("accepts non-empty overrides only outside production", () => {
    const overrides = '{"discount_codes":true}';

    expect(
      decodeFeatureFlagOverrideEnvironment({
        POSTHOG_FEATURE_FLAG_OVERRIDES: overrides,
        VERCEL_ENV: "preview",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toEqual({ discount_codes: true });
    expect(
      decodeFeatureFlagOverrideEnvironment({
        POSTHOG_FEATURE_FLAG_OVERRIDES: overrides,
        VERCEL_ENV: "development",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toEqual({ discount_codes: true });
    expect(() =>
      decodeFeatureFlagOverrideEnvironment({
        POSTHOG_FEATURE_FLAG_OVERRIDES: overrides,
        VERCEL_ENV: "production",
      })
    ).toThrow();
    expect(
      decodeFeatureFlagOverrideEnvironment({
        POSTHOG_FEATURE_FLAG_OVERRIDES: "{}",
        VERCEL_ENV: "production",
      }).POSTHOG_FEATURE_FLAG_OVERRIDES
    ).toBeUndefined();
  });
});
