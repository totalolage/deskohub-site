import "./shared/testing/workspace-test-environment";

import { defineConfig } from "@playwright/test";
import { parseWorkspaceE2EBaseUrl } from "./e2e/config";
import { workspaceE2ETimeouts } from "./e2e/timeouts";
import { env } from "./env";

const remoteBaseUrl = env.WORKSPACE_E2E_BASE_URL;
const baseUrl = remoteBaseUrl
  ? parseWorkspaceE2EBaseUrl(remoteBaseUrl).baseUrl
  : "http://localhost:3000";
const browserExecutablePath = env.AGENT_BROWSER_EXECUTABLE_PATH;

export default defineConfig({
  expect: { timeout: workspaceE2ETimeouts.browserAction },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: "./e2e-artifacts/instant-navigation",
  reporter: "line",
  retries: 0,
  testDir: "./e2e/instant-navigation",
  testMatch: "**/*.pw.ts",
  timeout: workspaceE2ETimeouts.browserNavigation,
  use: {
    baseURL: baseUrl,
    launchOptions: browserExecutablePath
      ? { executablePath: browserExecutablePath }
      : undefined,
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
  },
  webServer: remoteBaseUrl
    ? undefined
    : {
        command: "bun --cwd ../.. turbo dev --filter=deskohub-workspace",
        reuseExistingServer: true,
        timeout: workspaceE2ETimeouts.checkoutStart,
        url: `${baseUrl}/en-US`,
      },
  workers: 1,
});
