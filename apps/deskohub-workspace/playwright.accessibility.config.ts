import "./shared/testing/workspace-test-environment";

import { defineConfig, devices } from "@playwright/test";
import { parseWorkspaceE2EBaseUrl } from "./e2e/config";
import { workspaceE2ETimeouts } from "./e2e/timeouts";

const remoteBaseUrl = process.env.WORKSPACE_E2E_BASE_URL;
const localBaseUrl = process.env.WORKSPACE_ACCESSIBILITY_BASE_URL;
let baseUrl = "http://localhost:3110";
if (remoteBaseUrl) baseUrl = parseWorkspaceE2EBaseUrl(remoteBaseUrl).baseUrl;
if (localBaseUrl) baseUrl = new URL(localBaseUrl).origin;
const browserExecutablePath = process.env.AGENT_BROWSER_EXECUTABLE_PATH;

process.env.POSTHOG_FEATURE_FLAG_OVERRIDES ??= JSON.stringify({
  calendar_sales: true,
  discount_codes: true,
  meeting_room_page: true,
  office_page: true,
});

export default defineConfig({
  expect: { timeout: workspaceE2ETimeouts.browserAction },
  forbidOnly: true,
  fullyParallel: true,
  outputDir: "./e2e-artifacts/accessibility",
  projects: [
    {
      name: "desktop",
      use: { viewport: { height: 900, width: 1440 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "reduced-motion",
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
          reuseExistingServer: true,
          timeout: workspaceE2ETimeouts.checkoutStart,
          url: `${baseUrl}/en-US`,
        },
  workers: 3,
});
