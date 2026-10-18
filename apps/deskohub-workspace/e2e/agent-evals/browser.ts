import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BrowserContext,
  chromium,
  type LaunchOptions,
} from "@playwright/test";
import type { Locale } from "@/features/i18n";
import { workspaceE2EPollIntervalMs, workspaceE2ETimeouts } from "../timeouts";

/**
 * A Chromium the harness attaches to over the DevTools protocol. It is a
 * persistent context, so the cookies the run sets live in the browser's
 * default context, which is the one CDP clients see first.
 */
export type AgentEvalBrowser = {
  readonly cdpEndpoint: string;
  readonly context: BrowserContext;
  readonly close: () => Promise<void>;
};

const readDevToolsPort = async (userDataDir: string) => {
  const deadline = Date.now() + workspaceE2ETimeouts.browserAction;
  while (Date.now() < deadline) {
    try {
      const [port] = (
        await readFile(join(userDataDir, "DevToolsActivePort"), "utf8")
      ).split("\n");
      if (port && /^\d+$/.test(port)) return port;
    } catch (cause) {
      if (
        !(cause instanceof Error && "code" in cause && cause.code === "ENOENT")
      ) {
        throw cause;
      }
    }
    await new Promise((resolve) =>
      setTimeout(resolve, workspaceE2EPollIntervalMs.browser)
    );
  }
  throw new Error("Chromium did not publish its DevTools port");
};

/**
 * Launches the run's own Chromium with a loopback DevTools port. Agent evals
 * launch their browser instead of using Playwright's worker browser because
 * the harness must attach to it from another process.
 */
export const launchAgentEvalBrowser = async ({
  headless,
  launchOptions,
  locale,
}: {
  readonly headless: boolean;
  readonly launchOptions: LaunchOptions;
  readonly locale: Locale;
}): Promise<AgentEvalBrowser> => {
  const userDataDir = await mkdtemp(join(tmpdir(), "workspace-agent-eval-"));
  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      // Chromium binds the DevTools port to loopback and picks a free one.
      args: [...(launchOptions.args ?? []), "--remote-debugging-port=0"],
      headless,
      locale,
      viewport: { height: 900, width: 1440 },
    });
    const port = await readDevToolsPort(userDataDir).catch(async (cause) => {
      await context.close();
      throw cause;
    });
    return {
      cdpEndpoint: `http://127.0.0.1:${port}`,
      close: async () => {
        await context.close();
        await rm(userDataDir, { force: true, recursive: true });
      },
      context,
    };
  } catch (cause) {
    await rm(userDataDir, { force: true, recursive: true });
    throw cause;
  }
};
