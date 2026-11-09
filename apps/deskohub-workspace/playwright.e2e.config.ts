import "./shared/testing/workspace-test-environment";

import { defineConfig } from "@playwright/test";
import {
  workspaceE2EPlaywrightDefaults,
  workspaceE2EPlaywrightReporter,
} from "./e2e/playwright-defaults";
import {
  workspaceE2EAccessCodePlaywrightTimeout,
  workspaceE2EAdministratorAccessPlaywrightTimeout,
  workspaceE2EEmailCampaignPlaywrightTimeout,
  workspaceE2EPlaywrightCheckoutTimeout,
} from "./e2e/timeouts";

export default defineConfig({
  ...workspaceE2EPlaywrightDefaults,
  outputDir: "./e2e-artifacts/checkout",
  projects: [
    {
      name: "checkout-setup",
      teardown: "checkout-cleanup",
      testMatch: "setup.pw.ts",
    },
    {
      // Playwright awaits every project of a dependency phase before the next
      // one, so the long serial account lane shares the case phase.
      dependencies: ["checkout-setup"],
      name: "account-auth",
      testDir: "./e2e/account",
      testMatch: "account-lane.pw.ts",
      use: {
        screenshot: "off",
        trace: "off",
        video: "off",
      },
    },
    {
      dependencies: ["checkout-setup"],
      name: "checkout-cases",
      testMatch: "cases.pw.ts",
      // The hosted-payment permit, not the project, bounds Nexi sessions. The
      // case phase may queue account-auth after every case; the cap leaves a
      // worker free for the account lane from the first batch.
      workers: 5,
    },
    {
      name: "checkout-cleanup",
      testMatch: "cleanup.pw.ts",
    },
    {
      // Short seeded-session admin access cases, queued after the case pools
      // like the other admin cases, so they take a worker that frees up
      // instead of a slot of the first case batch.
      dependencies: ["checkout-setup"],
      name: "administrator-access",
      testDir: "./e2e/administrators",
      testMatch: "**/*.pw.ts",
      timeout: workspaceE2EAdministratorAccessPlaywrightTimeout,
    },
    {
      // Queued after the case pools like the access-code case, so it takes a
      // worker that frees up instead of a slot of the first case batch.
      dependencies: ["checkout-setup"],
      name: "email-campaign-recipient-preview",
      testDir: "./e2e/email-campaigns",
      testMatch: "**/*.pw.ts",
      timeout: workspaceE2EEmailCampaignPlaywrightTimeout,
    },
    {
      // Shares the case phase as its last-queued group: Playwright queues
      // top-level projects in config order, so it takes the first worker
      // that frees up instead of a slot of the first case batch.
      dependencies: ["checkout-setup"],
      name: "access-code-creation",
      testDir: "./e2e/access-codes",
      testMatch: "**/*.pw.ts",
      timeout: workspaceE2EAccessCodePlaywrightTimeout,
    },
  ],
  reporter: workspaceE2EPlaywrightReporter("Workspace E2E"),
  testDir: "./e2e/playwright-checkout",
  timeout: workspaceE2EPlaywrightCheckoutTimeout,
  workers: 6,
});
