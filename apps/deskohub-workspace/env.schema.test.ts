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

const validateMissingIgloohomeEnvironment = (
  missing: "credentials" | "target-device",
  vercelEnvironment: "production" | "preview"
) =>
  Bun.spawnSync({
    cmd: [
      process.execPath,
      "--preload",
      "./shared/testing/workspace-test-env.ts",
      "-e",
      missing === "credentials"
        ? 'delete process.env.IGLOOHOME_CLIENT_ID; delete process.env.IGLOOHOME_CLIENT_SECRET; await import("./env.ts");'
        : 'delete process.env.IGLOOHOME_ALGOPIN_TARGET_DEVICE_ID; await import("./env.ts");',
    ],
    cwd: import.meta.dir,
    env: { ...process.env, VERCEL_ENV: vercelEnvironment },
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
    const decodeIgloohomeTimeout = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.IGLOOHOME_API_TIMEOUT
    );
    const decodePostHogProjectId = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.POSTHOG_PROJECT_ID
    );

    expect(decodeTimeout(undefined)).toBe(5_000);
    expect(decodeTimeout("2500")).toBe(2_500);
    expect(decodeServiceName(undefined)).toBe("deskohub-workspace");
    expect(decodeIgloohomeTimeout(undefined)).toBe(10_000);
    expect(`${decodePostHogProjectId("42")}`).toBe("42");
    expect(decodePostHogProjectId(undefined)).toBeUndefined();
    expect(() => decodePostHogProjectId("")).toThrow();
    expect(() => decodeTimeout("1.5")).toThrow();
    expect(() => decodeTimeout("0")).toThrow();
  });

  test("always requires the Igloohome target device and requires credentials only in production", () => {
    const previewCredentials = validateMissingIgloohomeEnvironment(
      "credentials",
      "preview"
    );
    const productionCredentials = validateMissingIgloohomeEnvironment(
      "credentials",
      "production"
    );
    const previewTarget = validateMissingIgloohomeEnvironment(
      "target-device",
      "preview"
    );

    expect(previewCredentials.exitCode).toBe(0);
    expect(productionCredentials.exitCode).toBe(1);
    expect(productionCredentials.stderr.toString()).toContain(
      "Invalid Igloohome client credential configuration."
    );
    expect(previewTarget.exitCode).toBe(1);
    expect(previewTarget.stderr.toString()).toContain(
      "IGLOOHOME_ALGOPIN_TARGET_DEVICE_ID"
    );
  });

  test("validates URLs without changing their string representation", () => {
    const decodeDatabaseUrl = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.DATABASE_URL
    );
    const decodePostHogApiHost = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.POSTHOG_API_HOST
    );
    const decodePostHogIngestHost = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.POSTHOG_INGEST_HOST
    );
    const decodeE2EBaseUrl = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.WORKSPACE_E2E_BASE_URL
    );
    const databaseUrl = "postgres://user:pass@localhost:5432/workspace";

    expect(decodeDatabaseUrl(databaseUrl)).toBe(databaseUrl);
    expect(decodePostHogApiHost(undefined)).toBeUndefined();
    expect(decodePostHogApiHost("https://eu.posthog.com")).toBe(
      "https://eu.posthog.com"
    );
    expect(decodePostHogIngestHost("https://eu.i.posthog.com")).toBe(
      "https://eu.i.posthog.com"
    );
    expect(() => decodeDatabaseUrl("not a URL")).toThrow();
    expect(() => decodePostHogApiHost("not a URL")).toThrow();
    expect(() => decodePostHogIngestHost("not a URL")).toThrow();
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

  test("accepts an optional Playwright Chromium executable", () => {
    const decodeExecutablePath = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    );

    expect(decodeExecutablePath(undefined)).toBeUndefined();
    expect(decodeExecutablePath("/usr/bin/google-chrome")).toBe(
      "/usr/bin/google-chrome"
    );
  });

  test("validates accounting snapshot key IDs without accepting secrets", () => {
    const decodeKeyId = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.ACCOUNTING_DOCUMENT_SNAPSHOT_ACTIVE_KEY_ID
    );

    expect(decodeKeyId("K202608")).toBe("K202608");
    expect(() => decodeKeyId("key-202608")).toThrow();
    expect(() => decodeKeyId("K")).toThrow();
  });

  test("declares accounting snapshot secrets through static Next env access", async () => {
    const source = await Bun.file(new URL("./env.ts", import.meta.url)).text();

    expect(source).toContain(
      "K202608: process.env.ACCOUNTING_DOCUMENT_SNAPSHOT_KEY_K202608"
    );
    expect(source).not.toContain(
      "process.env[`ACCOUNTING_DOCUMENT_SNAPSHOT_KEY_"
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
