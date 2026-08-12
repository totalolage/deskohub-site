import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

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
