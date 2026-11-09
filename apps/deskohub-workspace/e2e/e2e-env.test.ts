import { describe, expect, test } from "bun:test";
import {
  makeAgentEvalEnvironment,
  makeE2EEnvironment,
  makeWorkspaceE2EEnvironment,
  nightlyCasesEnabled,
  toPlaywrightEnvironment,
} from "./e2e-env";
import {
  makeTestE2EEnvironment,
  validE2ERuntimeEnvironment,
} from "./e2e-env.test-fixture";

describe("Workspace E2E environment", () => {
  test("forwards only decoded variables that Playwright decodes back unchanged", () => {
    const environment = makeTestE2EEnvironment({
      GITHUB_RUN_ATTEMPT: "2",
      NEXI_API_KEY: "app-only-key",
      WORKSPACE_E2E_ALLOCATION_SHARD: "1",
      WORKSPACE_E2E_CAMPAIGN_REVIEW_SCREENSHOTS: "true",
    });
    const playwrightEnvironment = toPlaywrightEnvironment(environment);

    expect(playwrightEnvironment.GITHUB_RUN_ATTEMPT).toBe("2");
    expect(playwrightEnvironment.WORKSPACE_E2E_ALLOCATION_SHARD).toBe("1");
    expect(
      playwrightEnvironment.WORKSPACE_E2E_CAMPAIGN_REVIEW_SCREENSHOTS
    ).toBe("true");
    expect(playwrightEnvironment).not.toHaveProperty("NEXI_API_KEY");
    expect(playwrightEnvironment).not.toHaveProperty("WORKSPACE_E2E_PR_NUMBER");
    expect(makeWorkspaceE2EEnvironment(playwrightEnvironment)).toEqual(
      environment
    );
  });

  test("treats empty optional values as absent", () => {
    expect(
      makeTestE2EEnvironment({
        WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN: "",
      }).WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN
    ).toBeUndefined();
  });

  test("includes nightly cases only when the run opts in", () => {
    expect(nightlyCasesEnabled(makeTestE2EEnvironment({}))).toBe(false);
    expect(
      nightlyCasesEnabled(
        makeTestE2EEnvironment({ WORKSPACE_E2E_NIGHTLY_CASES: "true" })
      )
    ).toBe(true);
    expect(() =>
      makeTestE2EEnvironment({ WORKSPACE_E2E_NIGHTLY_CASES: "false" })
    ).toThrow();
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

  test("requires cross-worker provider coordination for Playwright", () => {
    for (const providerPermitRequired of [undefined, "true"]) {
      expect(() =>
        makeWorkspaceE2EEnvironment({
          ...validE2ERuntimeEnvironment,
          WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL: undefined,
          WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED: providerPermitRequired,
        })
      ).toThrow("Invalid workspace E2E environment variables.");
    }
  });

  test.each([
    { WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED: "false" },
    { WORKSPACE_E2E_CAMPAIGN_REVIEW_SCREENSHOTS: "false" },
    { WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL: "https://example.test" },
    {
      WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL:
        "postgresql://permit:synthetic-password@ep-coordinator-pooler.eu.neon.tech/neondb",
    },
  ])("rejects invalid E2E configuration", (runtimeEnvironment) => {
    expect(() =>
      makeE2EEnvironment({
        ...validE2ERuntimeEnvironment,
        ...runtimeEnvironment,
      })
    ).toThrow("Invalid workspace E2E environment variables.");
  });
});

describe("agent eval environment", () => {
  const agentEvalEnvironment = {
    TARGET_SHA: "a".repeat(40),
    WORKSPACE_AGENT_EVAL_HARNESSES: "/devbox/harnesses.json",
    WORKSPACE_E2E_VERCEL_PROJECT: "prj_workspace",
    WORKSPACE_E2E_VERCEL_TOKEN: "synthetic-token",
  };

  test("reads the pinned preview commit", () => {
    expect(makeAgentEvalEnvironment(agentEvalEnvironment).TARGET_SHA).toBe(
      "a".repeat(40)
    );
  });

  test.each([
    ["without TARGET_SHA", { TARGET_SHA: undefined }],
    ["with a short TARGET_SHA", { TARGET_SHA: "abc1234" }],
  ])("refuses to run %s", (_label, override) => {
    expect(() =>
      makeAgentEvalEnvironment({ ...agentEvalEnvironment, ...override })
    ).toThrow("TARGET_SHA");
  });
});
