import { openBrowserPage, waitForBrowserUrl } from "../browser";
import { getClickLocaleSwitchScript } from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import { getCheckoutTimeoutMs } from "../config";
import type { Runner } from "../runtime";
import { log, parseUrl } from "../runtime";
import type { CheckoutData } from "../types";

export const assertLocaleSwitcher = async ({
  config,
  run,
  session,
}: {
  config: WorkspaceE2EConfig;
  run: Runner;
  session: string;
}) => {
  await openBrowserPage(config, run, session, `${config.aliasUrl}/en-US`, {
    timeoutMs: getCheckoutTimeoutMs(),
  });

  for (let cycle = 1; cycle <= 3; cycle += 1) {
    await clickLocaleSwitchLink(run, session, "cs-CZ");
    await waitForBrowserUrl({
      description: `Czech locale switch ${cycle}`,
      matches: (url) => parseUrl(url)?.pathname.startsWith("/cs-CZ") ?? false,
      run,
      session,
      timeoutMs: 60_000,
    });

    await clickLocaleSwitchLink(run, session, "en-US");
    await waitForBrowserUrl({
      description: `English locale switch ${cycle}`,
      matches: (url) => parseUrl(url)?.pathname.startsWith("/en-US") ?? false,
      run,
      session,
      timeoutMs: 60_000,
    });
  }

  log("Locale switch e2e passed");
};

const clickLocaleSwitchLink = async (
  run: Runner,
  session: string,
  locale: CheckoutData["locale"] | "cs-CZ"
) => {
  await run("agent-browser", ["--session", session, "eval", "--stdin"], {
    input: getClickLocaleSwitchScript(locale),
    logOutput: false,
    timeoutMs: 30_000,
  });
};
