import { describe, expect, test } from "bun:test";
import { makeE2EEnvironment, makeWorkspaceE2EEnvironment } from "./e2e-env";
import {
  makeTestE2EEnvironment,
  validE2ERuntimeEnvironment,
} from "./e2e-env.test-fixture";

describe("Workspace E2E environment", () => {
  test("decodes typed telemetry context", () => {
    const environment = makeTestE2EEnvironment({
      GITHUB_RUN_ATTEMPT: "2",
      GITHUB_RUN_ID: "12345",
      GITHUB_STEP_SUMMARY: "/tmp/github-step-summary",
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "/usr/bin/google-chrome",
      TARGET_SHA: "a".repeat(40),
      WORKSPACE_E2E_EXECUTION_CONTEXT: "ci",
      WORKSPACE_E2E_ALLOCATION_SHARD: "2",
      WORKSPACE_E2E_POSTHOG_HOST: "https://us.i.posthog.com",
      WORKSPACE_E2E_PR_NUMBER: "127",
    });

    expect(environment.GITHUB_RUN_ATTEMPT).toBe(2);
    expect(environment.GITHUB_RUN_ID).toBe("12345");
    expect(environment.GITHUB_STEP_SUMMARY).toBe("/tmp/github-step-summary");
    expect(environment.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH).toBe(
      "/usr/bin/google-chrome"
    );
    expect(environment.TARGET_SHA).toBe("a".repeat(40));
    expect(environment.WORKSPACE_E2E_EXECUTION_CONTEXT).toBe("ci");
    expect(environment.WORKSPACE_E2E_ALLOCATION_SHARD).toBe(2);
    expect(environment.WORKSPACE_E2E_POSTHOG_HOST).toBe(
      "https://us.i.posthog.com"
    );
    expect(environment.WORKSPACE_E2E_PR_NUMBER).toBe(127);
  });

  test("treats empty optional values as absent", () => {
    expect(
      makeTestE2EEnvironment({
        WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN: "",
      }).WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN
    ).toBeUndefined();
  });

  test("decodes the GitHub-only Resend retrieval key when present", () => {
    const environment = makeTestE2EEnvironment({
      WORKSPACE_E2E_RESEND_API_KEY: "re_e2e-retrieval-key",
    });

    expect(environment.WORKSPACE_E2E_RESEND_API_KEY).toBe(
      "re_e2e-retrieval-key"
    );
  });

  test("treats a missing Resend retrieval key as absent instead of failing checkout cases", () => {
    expect(
      makeTestE2EEnvironment().WORKSPACE_E2E_RESEND_API_KEY
    ).toBeUndefined();
  });

  test("never exposes application mail authority through the E2E boundary", () => {
    const environment = makeTestE2EEnvironment({
      EMAIL_API_KEY: "deployed-send-only-key",
    });

    expect(environment).not.toHaveProperty("EMAIL_API_KEY");
  });

  test("does not expose application-only environment variables", () => {
    const environment = makeTestE2EEnvironment({
      NEXI_API_KEY: "app-only-key",
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "app-client-token",
      POSTHOG_API_KEY: "app-management-key",
    });

    expect(environment).not.toHaveProperty("NEXI_API_KEY");
    expect(environment).not.toHaveProperty("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN");
    expect(environment).not.toHaveProperty("POSTHOG_API_KEY");
  });

  test("does not expose timeout environment variables", () => {
    const environment = makeTestE2EEnvironment({
      DOTYPOS_API_TIMEOUT: "1",
      WORKSPACE_E2E_DATASOURCE_TIMEOUT_MS: "1",
    });

    expect(environment).not.toHaveProperty("DOTYPOS_API_TIMEOUT");
    expect(environment).not.toHaveProperty(
      "WORKSPACE_E2E_DATASOURCE_TIMEOUT_MS"
    );
  });

  test("requires the narrow provider coordination database when rollout is enabled", () => {
    expect(() =>
      makeWorkspaceE2EEnvironment({
        ...validE2ERuntimeEnvironment,
        WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED: "true",
        WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL: undefined,
      })
    ).toThrow("Invalid workspace E2E environment variables.");
  });

  test("does not expose the provider permit database to standalone diagnostics", () => {
    expect(
      makeE2EEnvironment({
        ...validE2ERuntimeEnvironment,
        WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL: undefined,
      }).WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL
    ).toBeUndefined();
  });

  test("requires cross-worker provider coordination for Playwright", () => {
    expect(() =>
      makeWorkspaceE2EEnvironment({
        ...validE2ERuntimeEnvironment,
        WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL: undefined,
        WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED: undefined,
      })
    ).toThrow("Invalid workspace E2E environment variables.");
  });

  test.each([
    { TARGET_SHA: "not-a-sha" },
    { WORKSPACE_E2E_EXECUTION_CONTEXT: "scheduled" },
    { WORKSPACE_E2E_ALLOCATION_SHARD: "4" },
    { WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED: "false" },
    { WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL: "https://example.test" },
    {
      WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL:
        "postgresql://permit:test@ep-coordinator-pooler.eu.neon.tech/neondb",
    },
    { WORKSPACE_E2E_POSTHOG_HOST: "not-a-url" },
    { WORKSPACE_E2E_PR_NUMBER: "0" },
  ])("rejects invalid E2E configuration", (runtimeEnvironment) => {
    expect(() =>
      makeE2EEnvironment({
        ...validE2ERuntimeEnvironment,
        ...runtimeEnvironment,
      })
    ).toThrow("Invalid workspace E2E environment variables.");
  });
});
