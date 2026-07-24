import { describe, expect, test } from "bun:test";
import { makeE2EEnvironment } from "./e2e-env";

describe("Workspace E2E environment", () => {
  test("decodes typed telemetry context", () => {
    const environment = makeE2EEnvironment({
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
      makeE2EEnvironment({
        WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN: "",
      }).WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN
    ).toBeUndefined();
  });

  test.each([
    { TARGET_SHA: "not-a-sha" },
    { WORKSPACE_E2E_EXECUTION_CONTEXT: "scheduled" },
    { WORKSPACE_E2E_POSTHOG_HOST: "not-a-url" },
    { WORKSPACE_E2E_PR_NUMBER: "0" },
  ])("rejects invalid telemetry configuration", (runtimeEnvironment) => {
    expect(() => makeE2EEnvironment(runtimeEnvironment)).toThrow(
      "Invalid workspace E2E environment variables."
    );
  });
});
