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
      workspaceServerEnvSchema.fields.POSTHOG_HOST
    );
    const decodeE2EBaseUrl = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.WORKSPACE_E2E_BASE_URL
    );
    const databaseUrl = "postgres://user:pass@localhost:5432/workspace";

    expect(decodeDatabaseUrl(databaseUrl)).toBe(databaseUrl);
    expect(decodePostHogHost(undefined)).toBeUndefined();
    expect(decodePostHogHost("https://eu.posthog.com")).toBe(
      "https://eu.posthog.com"
    );
    expect(() => decodeDatabaseUrl("not a URL")).toThrow();
    expect(() => decodePostHogHost("not a URL")).toThrow();
    expect(decodeE2EBaseUrl(undefined)).toBeUndefined();
    expect(decodeE2EBaseUrl("https://workspace.example")).toBe(
      "https://workspace.example"
    );
    expect(() => decodeE2EBaseUrl("not a URL")).toThrow();
  });

  test("accepts an absent or lowercase SHA-256 administration hash", () => {
    const decodeHash = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.ADMIN_BASIC_AUTH_SHA256
    );

    expect(decodeHash(undefined)).toBeUndefined();
    expect(decodeHash("7".repeat(64))).toBe("7".repeat(64));
    expect(() => decodeHash("7".repeat(63))).toThrow();
    expect(() => decodeHash("G".repeat(64))).toThrow();
  });

  test("accepts an optional hosted browser executable", () => {
    const decodeExecutablePath = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.AGENT_BROWSER_EXECUTABLE_PATH
    );

    expect(decodeExecutablePath(undefined)).toBeUndefined();
    expect(decodeExecutablePath("/usr/bin/google-chrome")).toBe(
      "/usr/bin/google-chrome"
    );
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
