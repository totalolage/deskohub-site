import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  workspaceClientEnvSchema,
  workspaceServerEnvSchema,
} from "./env.schema";

const validateFeatureFlagOverrideEnvironment = (
  vercelEnvironment: "production" | "preview"
) =>
  Bun.spawnSync({
    cmd: [
      process.execPath,
      "--preload",
      "./shared/testing/workspace-test-env.ts",
      "-e",
      'const { env } = await import("./env.ts"); if (env.POSTHOG_FEATURE_FLAG_OVERRIDES?.discount_codes !== true) process.exit(2);',
    ],
    cwd: import.meta.dir,
    env: {
      ...process.env,
      POSTHOG_FEATURE_FLAG_OVERRIDES: '{"discount_codes":true}',
      VERCEL_ENV: vercelEnvironment,
    },
    stderr: "pipe",
    stdout: "pipe",
  });

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

  test("retains server cross-field checks through T3 Env composition", () => {
    const previewValidation = validateFeatureFlagOverrideEnvironment("preview");
    const productionValidation =
      validateFeatureFlagOverrideEnvironment("production");
    const productionError = productionValidation.stderr.toString();

    expect(previewValidation.exitCode).toBe(0);
    expect(productionValidation.exitCode).toBe(1);
    expect(productionError).toContain(
      "Invalid PostHog feature flag override configuration."
    );
    expect(productionError).not.toContain('{"discount_codes":true}');
  });
});
