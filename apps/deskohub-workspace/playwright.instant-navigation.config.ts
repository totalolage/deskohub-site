import "./shared/testing/workspace-test-environment";

import { defineConfig } from "@playwright/test";
import {
  workspaceE2EPlaywrightDefaults,
  workspaceE2EPlaywrightReporter,
} from "./e2e/playwright-defaults";
import { workspaceE2ETimeouts } from "./e2e/timeouts";

// Read-only navigation runs as its own invocation beside the checkout graph:
// it takes no lease and must not gate checkout setup. Only its administration
// navigation seeds data: one synthetic administrator, journaled in this
// config's own output directory and deleted by its teardown project.
export default defineConfig({
  ...workspaceE2EPlaywrightDefaults,
  outputDir: "./e2e-artifacts/instant-navigation",
  reporter: workspaceE2EPlaywrightReporter("Workspace instant navigation E2E"),
  projects: [
    {
      // Seeds the synthetic administrator the administration navigation
      // signs in as; its teardown deletes it after those tests.
      name: "administrator-setup",
      teardown: "administrator-cleanup",
      testMatch: "administrator-setup.pw.ts",
    },
    {
      name: "administrator-cleanup",
      testMatch: "administrator-cleanup.pw.ts",
    },
    {
      dependencies: ["administrator-setup"],
      name: "administration-navigation",
      testMatch: "admin-navigation.pw.ts",
    },
    {
      // Public, account, and reservation navigation never waits for the
      // administrator setup.
      name: "navigation",
      testIgnore: [
        "admin-navigation.pw.ts",
        "administrator-cleanup.pw.ts",
        "administrator-setup.pw.ts",
      ],
    },
  ],
  testDir: "./e2e/instant-navigation",
  testMatch: "**/*.pw.ts",
  timeout: workspaceE2ETimeouts.browserNavigation,
  workers: 2,
});
