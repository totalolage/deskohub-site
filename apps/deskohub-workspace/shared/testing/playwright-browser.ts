import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { chromium } from "@playwright/test";

const systemChromiumCommands = [
  "google-chrome",
  "chromium",
  "chromium-browser",
] as const;

export const resolvePlaywrightChromiumExecutable = async (
  configuredPath: string | undefined,
  pathValue: string | undefined
): Promise<string | undefined> => {
  if (configuredPath) return configuredPath;

  for (const directory of pathValue?.split(delimiter) ?? []) {
    if (!directory) continue;
    for (const command of systemChromiumCommands) {
      const candidate = join(directory, command);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Keep looking; Playwright can still use its bundled browser.
      }
    }
  }

  return undefined;
};

/**
 * Reports whether Playwright's Chromium is installed so browser tests can skip
 * on a developer machine without it. CI installs Chromium, so a missing browser
 * there fails the suite instead of silently skipping its coverage.
 */
export const playwrightChromiumAvailable = async (
  executablePath: string = chromium.executablePath(),
  ci: boolean = Boolean(process.env.CI)
): Promise<boolean> => {
  try {
    await access(executablePath, constants.X_OK);
    return true;
  } catch (cause) {
    if (ci) {
      throw new Error(
        `Playwright Chromium is not installed at ${executablePath}; run \`bunx playwright install chromium\` before the browser tests.`,
        { cause }
      );
    }
    return false;
  }
};
