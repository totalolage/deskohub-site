import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
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

const validateServerEnvironment = (
  mutation: string,
  vercelEnvironment: "production" | "preview" | "development"
) =>
  Bun.spawnSync({
    cmd: [
      process.execPath,
      "--preload",
      "./shared/testing/workspace-test-env.ts",
      "-e",
      `${mutation}; await import("./env.ts");`,
    ],
    cwd: import.meta.dir,
    env: { ...process.env, VERCEL_ENV: vercelEnvironment },
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

const validateMissingBrowserPostHogHost = () =>
  Bun.spawnSync({
    cmd: [
      process.execPath,
      "--preload",
      "./shared/testing/workspace-test-env.ts",
      "-e",
      'delete process.env.NEXT_PUBLIC_POSTHOG_HOST; await import("./env.ts");',
    ],
    cwd: import.meta.dir,
    env: {
      ...process.env,
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test",
    },
    stderr: "pipe",
    stdout: "pipe",
  });

const validateAdministratorCredentialEnvironment = (
  administratorCredentials: string | undefined
) =>
  Bun.spawnSync({
    cmd: [
      process.execPath,
      "--preload",
      "./shared/testing/workspace-test-env.ts",
      "-e",
      administratorCredentials === undefined
        ? 'delete process.env.ADMIN_BASIC_AUTH_CREDENTIALS; await import("./env.ts");'
        : 'await import("./env.ts");',
    ],
    cwd: import.meta.dir,
    env: {
      ...process.env,
      ADMIN_BASIC_AUTH_CREDENTIALS: administratorCredentials,
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

  test("bounds the Igloohome timeout at the shared per-request maximum", () => {
    const decodeIgloohomeTimeout = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.IGLOOHOME_API_TIMEOUT
    );

    expect(decodeIgloohomeTimeout("20000")).toBe(20_000);
    expect(() => decodeIgloohomeTimeout("20001")).toThrow();
    expect(() => decodeIgloohomeTimeout("0")).toThrow();
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

  test("requires a non-empty Resend webhook secret", () => {
    const decodeSecret = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.RESEND_WEBHOOK_SECRET
    );

    expect(() => decodeSecret(undefined)).toThrow();
    expect(() => decodeSecret("")).toThrow();
    expect(decodeSecret("whsec_synthetic_test_value")).toBe(
      "whsec_synthetic_test_value"
    );
  });

  test("validates the Better Auth secrets without making them browser-visible", () => {
    const decodeSecrets = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.BETTER_AUTH_SECRETS
    );

    expect(decodeSecrets(undefined)).toBeUndefined();
    expect(decodeSecrets("1:synthetic-secret")).toBe("1:synthetic-secret");
    expect(() => decodeSecrets("")).toThrow();
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
    expect(() => decodePostHogApiHost(undefined)).toThrow();
    expect(decodePostHogApiHost("https://eu.posthog.com")).toBe(
      "https://eu.posthog.com"
    );
    expect(() => decodePostHogIngestHost(undefined)).toThrow();
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

  test("requires a registry of well-formed newline-separated administrator credentials", () => {
    const decodeRegistry = Schema.decodeUnknownSync(
      workspaceServerEnvSchema.fields.ADMIN_BASIC_AUTH_CREDENTIALS
    );
    const digest = (credential: string) =>
      createHash("sha256").update(credential).digest("hex");
    const primary = `admin:${digest("admin:synthetic-password")}`;
    const secondary = `operator:${digest("operator:synthetic-password")}`;

    expect(decodeRegistry(`${primary}\n${secondary}`)).toHaveLength(2);
    expect(decodeRegistry(`${primary}\r\n${secondary}`)).toHaveLength(2);
    expect(decodeRegistry(secondary)).toHaveLength(1);
    expect(() => decodeRegistry(undefined)).toThrow();
    expect(() => decodeRegistry("")).toThrow();
    expect(() => decodeRegistry(`${primary}\n`)).toThrow();
    expect(() => decodeRegistry(`\n${primary}`)).toThrow();
    expect(() => decodeRegistry(`${primary}\n\n${secondary}`)).toThrow();
    expect(() => decodeRegistry(`${primary}\n   \n${secondary}`)).toThrow();
    expect(() => decodeRegistry(`${primary}\nadmin`)).toThrow();
    expect(() =>
      decodeRegistry(`${primary}\nadmin:${digest("admin:another-password")}`)
    ).toThrow();
  });

  test("fails closed for missing, empty, and malformed administrator registries without exposing values", () => {
    const secretDigest = createHash("sha256")
      .update("hushhush:quiet-synthetic-password")
      .digest("hex");
    const missing = validateAdministratorCredentialEnvironment(undefined);
    const empty = validateAdministratorCredentialEnvironment("");
    const malformed = validateAdministratorCredentialEnvironment(
      `hushhush:${secretDigest}\nnonsense`
    );

    for (const validation of [missing, empty, malformed]) {
      expect(validation.exitCode).toBe(1);
      const error = validation.stderr.toString();
      expect(error).toContain(
        "Invalid administrator credential registry configuration."
      );
      expect(error).not.toContain("hushhush");
      expect(error).not.toContain(secretDigest);
      expect(error).not.toContain("quiet-synthetic-password");
    }
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

  test("fails production closed when delivery or cron authentication is unconfigured", () => {
    const cases: readonly {
      readonly mutation: string;
      readonly expected: string;
    }[] = [
      {
        mutation: "delete process.env.EMAIL_API_KEY",
        expected: "Invalid production email delivery configuration.",
      },
      {
        mutation: 'process.env.EMAIL_API_KEY = "   "',
        expected: "Invalid production email delivery configuration.",
      },
      {
        mutation: "delete process.env.CRON_SECRET",
        expected: "Invalid production cron authentication configuration.",
      },
      {
        mutation: 'process.env.CRON_SECRET = ""',
        expected: "Invalid production cron authentication configuration.",
      },
    ];

    for (const { mutation, expected } of cases) {
      const validation = validateServerEnvironment(mutation, "production");
      const error = validation.stderr.toString();

      expect(validation.exitCode).toBe(1);
      expect(error).toContain(expected);
      expect(error).not.toContain("re_");
    }
  });

  test("keeps local development and preview usable without delivery or cron secrets", () => {
    const mutation =
      "delete process.env.EMAIL_API_KEY; delete process.env.CRON_SECRET;";

    for (const vercelEnvironment of ["development", "preview"] as const) {
      const validation = validateServerEnvironment(mutation, vercelEnvironment);
      expect(validation.exitCode).toBe(0);
    }
  });

  test("fails production closed when Better Auth secrets are absent or invalid", () => {
    const strongSecret = "9tEWbGQfP2vXcK7mRz4sLh6yUnAoJd1e";
    const cases: readonly {
      readonly mutation: string;
      readonly neverEcho?: string;
    }[] = [
      { mutation: "delete process.env.BETTER_AUTH_SECRETS" },
      {
        mutation:
          'process.env.BETTER_AUTH_SECRETS = "leaked-malformed-secret-token";',
        neverEcho: "leaked-malformed-secret-token",
      },
      {
        mutation:
          'process.env.BETTER_AUTH_SECRETS = "1:leaked-weak-secret-value";',
        neverEcho: "leaked-weak-secret-value",
      },
      {
        mutation: `process.env.BETTER_AUTH_SECRETS = "1:${strongSecret},1:${strongSecret}";`,
        neverEcho: strongSecret,
      },
      {
        mutation: 'process.env.BETTER_AUTH_SECRETS = "1:" + "a".repeat(48);',
      },
    ];

    for (const { mutation, neverEcho } of cases) {
      const validation = validateServerEnvironment(mutation, "production");
      const error = validation.stderr.toString();

      expect(validation.exitCode).toBe(1);
      expect(error).toContain("Invalid Better Auth secret configuration.");
      if (neverEcho !== undefined) {
        expect(error).not.toContain(neverEcho);
      }
    }
  });

  test("accepts valid rotating Better Auth secrets in production", () => {
    const rotatedSecret = "Qw7eNb2mVzYr8sKx4tLp6hUcJoAd5gRf";
    const validation = validateServerEnvironment(
      `process.env.BETTER_AUTH_SECRETS = "3:${rotatedSecret},1:9tEWbGQfP2vXcK7mRz4sLh6yUnAoJd1e";`,
      "production"
    );

    expect(validation.exitCode).toBe(0);
  });

  test("keeps local development and preview usable without Better Auth secrets", () => {
    for (const vercelEnvironment of ["development", "preview"] as const) {
      const validation = validateServerEnvironment(
        "delete process.env.BETTER_AUTH_SECRETS;",
        vercelEnvironment
      );
      expect(validation.exitCode).toBe(0);
    }
  });

  test("requires the browser PostHog proxy when browser analytics is enabled", () => {
    const validation = validateMissingBrowserPostHogHost();

    expect(validation.exitCode).toBe(1);
    expect(validation.stderr.toString()).toContain(
      "NEXT_PUBLIC_POSTHOG_HOST is required when browser PostHog is enabled."
    );
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
