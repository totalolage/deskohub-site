import { expect, test } from "bun:test";
import { makeTestE2EEnvironment } from "./e2e-env.test-fixture";
import { getRunnerCommandEnvironment } from "./runtime";
import { workspaceE2ETimeouts } from "./timeouts";

test("keeps one stable timeout configuration across agent-browser commands", () => {
  const environment = makeTestE2EEnvironment();

  expect(getRunnerCommandEnvironment(environment, "agent-browser")).toEqual(
    expect.objectContaining({
      AGENT_BROWSER_DEFAULT_TIMEOUT: String(
        workspaceE2ETimeouts.checkoutStart
      ),
    })
  );
  expect(
    getRunnerCommandEnvironment(environment, "agent-browser", {
      AGENT_BROWSER_DEFAULT_TIMEOUT: "1",
    })
  ).toHaveProperty(
    "AGENT_BROWSER_DEFAULT_TIMEOUT",
    String(workspaceE2ETimeouts.checkoutStart)
  );
  expect(
    getRunnerCommandEnvironment(environment, "psql")
  ).not.toHaveProperty("AGENT_BROWSER_DEFAULT_TIMEOUT");
});
