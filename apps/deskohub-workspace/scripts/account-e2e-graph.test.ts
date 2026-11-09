import { describe, expect, test } from "bun:test";
import { runCommand } from "./shared/command";

type PlaywrightCheckoutConfig =
  typeof import("../playwright.e2e.config")["default"];

// The real Playwright config is executed (not text-scanned) and its resolved
// structure is asserted on. It runs in a child process because the config
// resolves its browser executable with a top-level await, which bun's test
// runner does not settle reliably across multiple entry files.
const loadPlaywrightConfigStructure =
  async (): Promise<PlaywrightCheckoutConfig> => {
    const result = await runCommand(
      [
        process.execPath,
        "-e",
        'const config = (await import("./playwright.e2e.config")).default; console.log(JSON.stringify(config));',
      ],
      { cwd: new URL("..", import.meta.url).pathname, timeoutMs: 15_000 }
    );
    if (result.timedOut) {
      throw new Error("actual Playwright config loader timed out");
    }
    if (result.signalCode !== null) {
      throw new Error("actual Playwright config loader was interrupted");
    }
    if (result.exitCode !== 0) {
      throw new Error(
        `actual Playwright config loader exited with status ${result.exitCode}`
      );
    }
    try {
      return JSON.parse(result.stdout) as PlaywrightCheckoutConfig;
    } catch {
      throw new Error("actual Playwright config loader emitted invalid JSON");
    }
  };

let cachedConfigStructure: Promise<PlaywrightCheckoutConfig> | undefined;
const playwrightConfigStructure = (): Promise<PlaywrightCheckoutConfig> => {
  cachedConfigStructure ??= loadPlaywrightConfigStructure();
  return cachedConfigStructure;
};

const projectByName = (config: PlaywrightCheckoutConfig, name: string) =>
  config.projects.find((project) => project.name === name);

describe("workspace account e2e graph", () => {
  test("keeps account cases free of screenshots, traces, and videos", async () => {
    // Magic links and emails must stay out of uploaded artifacts.
    const config = await playwrightConfigStructure();
    const project = projectByName(config, "account-auth");

    expect(project?.use?.screenshot).toBe("off");
    expect(project?.use?.trace).toBe("off");
    expect(project?.use?.video).toBe("off");
  });

  test("journals only exact identifiers", async () => {
    const { emptyWorkspaceE2EAccountJournal } = await import(
      "../e2e/account/journal"
    );
    const fields = Object.keys(emptyWorkspaceE2EAccountJournal());

    expect(fields.join(",")).not.toMatch(/email|recipient|url|token|cookie/i);
  });
});
