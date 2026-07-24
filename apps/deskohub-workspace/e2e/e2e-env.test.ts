import { describe, expect, test } from "bun:test";
import { makeE2EEnvironment } from "./e2e-env";
import {
  makeTestE2EEnvironment,
  validE2ERuntimeEnvironment,
} from "./e2e-env.test-fixture";

describe("Workspace E2E environment", () => {
  test("decodes typed telemetry context", () => {
    const environment = makeTestE2EEnvironment({
      GITHUB_RUN_ATTEMPT: "2",
      GITHUB_RUN_ID: "12345",
      TARGET_SHA: "a".repeat(40),
      WORKSPACE_E2E_EXECUTION_CONTEXT: "ci",
      WORKSPACE_E2E_POSTHOG_HOST: "https://us.i.posthog.com",
      WORKSPACE_E2E_PR_NUMBER: "127",
    });

    expect(environment.GITHUB_RUN_ATTEMPT).toBe(2);
    expect(environment.GITHUB_RUN_ID).toBe("12345");
    expect(environment.TARGET_SHA).toBe("a".repeat(40));
    expect(environment.WORKSPACE_E2E_EXECUTION_CONTEXT).toBe("ci");
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

  test("does not expose application-only environment variables", () => {
    const environment = makeTestE2EEnvironment({
      NEXI_API_KEY: "app-only-key",
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "app-client-token",
      POSTHOG_API_KEY: "app-management-key",
    });

    expect(environment).not.toHaveProperty("NEXI_API_KEY");
    expect(environment).not.toHaveProperty(
      "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN"
    );
    expect(environment).not.toHaveProperty("POSTHOG_API_KEY");
  });

  test.each([
    { TARGET_SHA: "not-a-sha" },
    { WORKSPACE_E2E_DATASOURCE_TIMEOUT_MS: "0" },
    { WORKSPACE_E2E_EXECUTION_CONTEXT: "scheduled" },
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
