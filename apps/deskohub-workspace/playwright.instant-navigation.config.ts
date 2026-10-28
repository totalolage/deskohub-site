import "./shared/testing/workspace-test-environment";

import { defineConfig } from "@playwright/test";
import {
  workspaceE2EPlaywrightDefaults,
  workspaceE2EPlaywrightReporter,
} from "./e2e/playwright-defaults";
import { workspaceE2ETimeouts } from "./e2e/timeouts";

// Read-only navigation runs as its own invocation beside the checkout graph:
// it takes no lease and must not gate checkout setup. Administration navigation
// seeds one synthetic administrator. The opt-in review capture also creates
// and expires one synthetic Dotypos profile for the customer calendar page.
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
    {
      // Safari and every iOS browser run WebKit, which gets the Temporal
      // polyfill from the `<head>` loader. Its failures keep a trace, which
      // the trace reporter sanitizes before it can be uploaded.
      name: "webkit",
      testMatch: "temporal-runtime.pw.ts",
      use: {
        browserName: "webkit",
        launchOptions: {},
        trace: "retain-on-failure",
      },
    },
  ],
  testDir: "./e2e/instant-navigation",
  testMatch: "**/*.pw.ts",
  timeout: workspaceE2ETimeouts.browserNavigation,
  workers: 2,
});
