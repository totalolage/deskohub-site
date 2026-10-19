import "./shared/testing/workspace-test-environment";

import { defineConfig } from "@playwright/test";
import { agentEvalMinimumRunsPerCell } from "./e2e/agent-evals/results";
import { agentEvalOutputDirectory } from "./e2e/agent-evals/run-set";
import { workspaceE2EPlaywrightDefaults } from "./e2e/playwright-defaults";
import {
  workspaceAgentEvalPlaywrightTimeout,
  workspaceAgentEvalTimeouts,
} from "./e2e/timeouts";

// Agent task evals: real browser agents work through reservation tasks on a
// protected preview. Run on the devbox only, by hand; no CI workflow, turbo
// task, or E2E launcher runs this config.
export default defineConfig({
  ...workspaceE2EPlaywrightDefaults,
  // A failed eval is recorded, not thrown; a test fails only on preparation
  // or cleanup errors. Tolerate a few before stopping a long run set.
  maxFailures: 5,
  outputDir: agentEvalOutputDirectory,
  projects: [
    {
      name: "agent-eval-setup",
      teardown: "agent-eval-report",
      testMatch: "agent-eval-setup.pw.ts",
    },
    {
      name: "agent-eval-report",
      testMatch: "agent-eval-report.pw.ts",
    },
    {
      dependencies: ["agent-eval-setup"],
      name: "agent-evals",
      repeatEach: agentEvalMinimumRunsPerCell,
      testMatch: "agent-evals.pw.ts",
    },
  ],
  reporter: "line",
  testDir: "./e2e/agent-evals",
  timeout: workspaceAgentEvalPlaywrightTimeout(
    workspaceAgentEvalTimeouts.paymentTask
  ),
  webServer: undefined,
  // Each run holds a reservation on the shared Dotypos sandbox while its
  // agent works; two at a time keep holds from piling up.
  workers: 2,
});
