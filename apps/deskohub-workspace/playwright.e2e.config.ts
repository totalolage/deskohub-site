import "./shared/testing/workspace-test-environment";

import { defineConfig } from "@playwright/test";
import { parseWorkspaceE2EBaseUrl } from "./e2e/config";
import {
  workspaceE2EAccessCodePlaywrightTimeout,
  workspaceE2EPlaywrightCheckoutTimeout,
  workspaceE2ETimeouts,
} from "./e2e/timeouts";
import { env } from "./env";
import { resolvePlaywrightChromiumExecutable } from "./shared/testing/playwright-browser";

const remoteBaseUrl = env.WORKSPACE_E2E_BASE_URL;
const baseUrl = remoteBaseUrl
  ? parseWorkspaceE2EBaseUrl(remoteBaseUrl).baseUrl
  : "http://localhost:3000";
const browserExecutablePath = await resolvePlaywrightChromiumExecutable(
  env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.PATH
);
const checkoutCaseProjects = [
  "checkout-non-payment",
  "checkout-payment-1",
  "checkout-payment-2",
  "checkout-payment-3",
] as const;

export default defineConfig({
  expect: { timeout: workspaceE2ETimeouts.browserAction },
  forbidOnly: true,
  fullyParallel: true,
  maxFailures: 1,
  outputDir: "./e2e-artifacts/checkout",
  projects: [
    {
      name: "instant-navigation",
      testDir: "./e2e/instant-navigation",
      testMatch: "**/*.pw.ts",
      timeout: workspaceE2ETimeouts.browserNavigation,
    },
    {
      dependencies: ["checkout-setup"],
      name: "access-code-creation",
      testDir: "./e2e/access-codes",
      testMatch: "**/*.pw.ts",
      timeout: workspaceE2EAccessCodePlaywrightTimeout,
    },
    {
      name: "checkout-setup",
      teardown: "checkout-cleanup",
      testMatch: "setup.pw.ts",
    },
    {
      dependencies: ["checkout-setup"],
      name: "checkout-seed",
      testMatch: "seed.pw.ts",
    },
    {
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
      dependencies: ["checkout-setup", "checkout-seed"],
      name: "checkout-availability",
      testMatch: "availability.pw.ts",
    },
    {
      dependencies: ["checkout-setup"],
      name: "checkout-provider-preparation",
      testMatch: "provider-preparation.pw.ts",
    },
    {
      dependencies: ["checkout-setup"],
      name: "checkout-invoice-persistence",
      testMatch: "invoice-persistence.pw.ts",
    },
    {
      dependencies: [
        "checkout-availability",
        "checkout-provider-preparation",
        "checkout-invoice-persistence",
      ],
      name: "checkout-plan",
      testMatch: "plan.pw.ts",
    },
    {
      dependencies: ["checkout-plan"],
      name: "checkout-non-payment",
      testMatch: "non-payment.pw.ts",
    },
    {
      dependencies: ["checkout-plan"],
      name: "checkout-payment-1",
      testMatch: "payment-lane-1.pw.ts",
    },
    {
      dependencies: ["checkout-plan"],
      name: "checkout-payment-2",
      testMatch: "payment-lane-2.pw.ts",
    },
    {
      dependencies: ["checkout-plan"],
      name: "checkout-payment-3",
      testMatch: "payment-lane-3.pw.ts",
    },
    {
      dependencies: [...checkoutCaseProjects],
      name: "checkout-shared-fixture",
      testMatch: "shared-fixture.pw.ts",
    },
    {
      name: "checkout-cleanup",
      testMatch: "cleanup.pw.ts",
    },
  ],
  reporter: [
    ["line"],
    [
      "./e2e/playwright-github-summary.ts",
      {
        outputFile: env.GITHUB_STEP_SUMMARY,
        title: "Workspace E2E",
      },
    ],
  ],
  retries: 0,
  testDir: "./e2e/playwright-checkout",
  timeout: workspaceE2EPlaywrightCheckoutTimeout,
  use: {
    baseURL: baseUrl,
    launchOptions: browserExecutablePath
      ? { executablePath: browserExecutablePath }
      : undefined,
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
    viewport: { height: 900, width: 1440 },
  },
  webServer: remoteBaseUrl
    ? undefined
    : {
        command: "bun --cwd ../.. turbo dev --filter=deskohub-workspace",
        reuseExistingServer: true,
        timeout: workspaceE2ETimeouts.checkoutStart,
        url: `${baseUrl}/en-US`,
      },
  workers: 6,
});
