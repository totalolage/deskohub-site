import { Effect } from "effect";
import {
  evalBrowserScript,
  openBrowserPage,
  waitForBrowserUrl,
} from "../browser";
import { getClickLocaleSwitchScript } from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import { getCheckoutTimeoutMs } from "../config";
import type { WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { log, parseUrl } from "../runtime";
import type { CheckoutData } from "../types";

export const assertLocaleSwitcher = ({
  config,
  run,
  session,
}: {
  config: WorkspaceE2EConfig;
  run: Runner;
  session: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* openBrowserPage(config, run, session, `${config.browserUrl}/en-US`, {
      timeoutMs: getCheckoutTimeoutMs(),
    });

    for (let cycle = 1; cycle <= 3; cycle += 1) {
      yield* clickLocaleSwitchLink(run, session, "cs-CZ");
      yield* waitForBrowserUrl({
        description: `Czech locale switch ${cycle}`,
        matches: (url) => parseUrl(url)?.pathname.startsWith("/cs-CZ") ?? false,
        run,
        session,
        timeoutMs: 60_000,
      });

      yield* clickLocaleSwitchLink(run, session, "en-US");
      yield* waitForBrowserUrl({
        description: `English locale switch ${cycle}`,
        matches: (url) => parseUrl(url)?.pathname.startsWith("/en-US") ?? false,
        run,
        session,
        timeoutMs: 60_000,
      });
    }

    log("Locale switch e2e passed");
  });

const clickLocaleSwitchLink = (
  run: Runner,
  session: string,
  locale: CheckoutData["locale"] | "cs-CZ"
) =>
  evalBrowserScript(
    `click ${locale} locale switch link`,
    run,
    session,
    getClickLocaleSwitchScript(locale),
    {
      logOutput: false,
      timeoutMs: 30_000,
    }
  );
