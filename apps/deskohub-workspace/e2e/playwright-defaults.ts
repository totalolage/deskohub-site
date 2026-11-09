import type { PlaywrightTestConfig } from "@playwright/test";
import { env } from "../env";
import { resolvePlaywrightChromiumExecutable } from "../shared/testing/playwright-browser";
import { parseWorkspaceE2EBaseUrl } from "./config";
import { workspaceE2ETimeouts } from "./timeouts";

const remoteBaseUrl = env.WORKSPACE_E2E_BASE_URL;
const baseUrl = remoteBaseUrl
  ? parseWorkspaceE2EBaseUrl(remoteBaseUrl).baseUrl
  : "http://localhost:3000";
const browserExecutablePath = await resolvePlaywrightChromiumExecutable(
  env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.PATH
);

/** Settings shared by every Playwright invocation of one Workspace E2E run. */
export const workspaceE2EPlaywrightDefaults = {
  expect: { timeout: workspaceE2ETimeouts.browserAction },
  forbidOnly: true,
  fullyParallel: true,
  maxFailures: 1,
  retries: 0,
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
} satisfies PlaywrightTestConfig;

// Traces are sanitized before any other reporter reads their paths.
export const workspaceE2EPlaywrightReporter = (
  title: string
): PlaywrightTestConfig["reporter"] => [
  [
    "./e2e/playwright-trace-reporter.ts",
    { origins: remoteBaseUrl ? [new URL(baseUrl).origin] : [] },
  ],
  ["line"],
  [
    "./e2e/playwright-github-summary.ts",
    { outputFile: env.GITHUB_STEP_SUMMARY, title },
  ],
];
