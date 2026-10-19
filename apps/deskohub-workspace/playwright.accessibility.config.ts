import "./shared/testing/workspace-test-environment";

import { defineConfig, devices } from "@playwright/test";
import { Schema } from "effect";
import { parseWorkspaceE2EBaseUrl } from "./e2e/config";
import { workspaceE2ETimeouts } from "./e2e/timeouts";
import { resolvePlaywrightChromiumExecutable } from "./shared/testing/playwright-browser";

const remoteBaseUrl = process.env.WORKSPACE_E2E_BASE_URL;
const localBaseUrl = process.env.WORKSPACE_ACCESSIBILITY_BASE_URL;
let baseUrl = "http://localhost:3110";
if (remoteBaseUrl) baseUrl = parseWorkspaceE2EBaseUrl(remoteBaseUrl).baseUrl;
if (localBaseUrl) baseUrl = new URL(localBaseUrl).origin;
const browserExecutablePath = await resolvePlaywrightChromiumExecutable(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.PATH
);

// The audited pages and every account section are released. Overrides the
// caller passes, such as development ones from an env file, are kept but
// can't switch these off.
const developmentFlagOverrides = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Unknown)
)(JSON.parse(process.env.POSTHOG_FEATURE_FLAG_OVERRIDES ?? "{}"));
process.env.POSTHOG_FEATURE_FLAG_OVERRIDES = JSON.stringify({
  ...developmentFlagOverrides,
  calendar_sales: true,
  discount_codes: true,
  login_passkeys: true,
  meeting_room_page: true,
  office_page: true,
  referrals: true,
});

const accountSessionSetup = "account-session-setup.pw.ts";
const accountSessionCleanup = "account-session-cleanup.pw.ts";
const ariaSnapshots = "workspace-aria-snapshots.pw.ts";
// Holds a real Dotypos sandbox reservation per case, so it runs once.
const checkoutPay = "checkout-pay-accessibility.pw.ts";
const auditTestIgnore = [accountSessionSetup, accountSessionCleanup];

export default defineConfig({
  expect: { timeout: workspaceE2ETimeouts.browserAction },
  forbidOnly: true,
  fullyParallel: true,
  outputDir: "./e2e-artifacts/accessibility",
  projects: [
    {
      // Seeds the synthetic account the account audits sign in as; its
      // teardown deletes it after every audit project finished.
      name: "account-session-setup",
      teardown: "account-session-cleanup",
      testMatch: accountSessionSetup,
    },
    {
      name: "account-session-cleanup",
      testMatch: accountSessionCleanup,
    },
    {
      // ARIA snapshots record roles and names, which are the same on every
      // viewport: the mobile header collapses into a menu outside the
      // snapshotted forms and cards, and reduced motion changes no
      // semantics. They and the Pay audit run once, here.
      dependencies: ["account-session-setup"],
      name: "desktop",
      testIgnore: auditTestIgnore,
      use: { viewport: { height: 900, width: 1440 } },
    },
    {
      dependencies: ["account-session-setup"],
      name: "mobile",
      testIgnore: [...auditTestIgnore, ariaSnapshots, checkoutPay],
      use: { ...devices["Pixel 7"] },
    },
    {
      dependencies: ["account-session-setup"],
      name: "reduced-motion",
      testIgnore: [...auditTestIgnore, ariaSnapshots, checkoutPay],
      use: {
        contextOptions: { reducedMotion: "reduce" },
        viewport: { height: 900, width: 1440 },
      },
    },
  ],
  reporter: "line",
  retries: 0,
  testDir: "./e2e/accessibility",
  testMatch: "**/*.pw.ts",
  timeout: workspaceE2ETimeouts.checkoutStart,
  use: {
    baseURL: baseUrl,
    launchOptions: browserExecutablePath
      ? { executablePath: browserExecutablePath }
      : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer:
    remoteBaseUrl || localBaseUrl
      ? undefined
      : {
          command: "bun dev:next --port 3110",
          // Local Better Auth accepts its development host and the
          // deployment URL, so this port must be the deployment URL for
          // seeded sessions to authenticate.
          env: { VERCEL_URL: new URL(baseUrl).host },
          reuseExistingServer: true,
          timeout: workspaceE2ETimeouts.checkoutStart,
          url: `${baseUrl}/en-US`,
        },
  workers: 3,
});
