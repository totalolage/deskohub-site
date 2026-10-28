import { Effect } from "effect";
import { activateHydratedElement, openPage, waitForPageUrl } from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import type { WorkspaceE2EStepRunner } from "../case-runner";
import type { WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import { browserSessionFor, log, parseUrl, type Runner } from "../runtime";
import type { WorkspaceE2ETimeouts } from "../timeouts";
import type { CheckoutData } from "../types";

export const assertLocaleSwitcher = ({
  config,
  run,
  runStep,
  session,
}: {
  config: Pick<WorkspaceE2EConfig, "baseUrl" | "bypassSecret" | "timeouts">;
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  session: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const browser = browserSessionFor(run, session);
    yield* runStep({
      execute: Effect.flatMap(browser, (opened) =>
        openPage(opened, config, `${config.baseUrl}/en-US`, {
          timeoutMs: config.timeouts.browserNavigation,
        })
      ),
      id: "open-home-page",
      timeoutMs: config.timeouts.browserNavigation,
    });

    yield* runStep({
      execute: Effect.flatMap(browser, (opened) =>
        switchLocale(opened, "cs-CZ", config.timeouts)
      ),
      id: "switch-to-czech",
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* runStep({
      execute: Effect.flatMap(browser, (opened) =>
        switchLocale(opened, "en-US", config.timeouts)
      ),
      id: "switch-to-english",
      timeoutMs: config.timeouts.browserNavigation,
    });

    log("Locale switch e2e passed");
  });

type SwitchLocale = CheckoutData["locale"] | "cs-CZ";

const localeSwitchLinkSelector = (locale: SwitchLocale) =>
  `[data-locale-switcher] a[href^="/${locale}"]`;

/**
 * Switches the locale through the header with a native activation of the
 * hydrated link. For a signed-in visitor the switcher saves the language
 * preference before the document navigation, waiting for the streamed
 * session check if needed, so the URL wait also proves the save: without it
 * the proxy would redirect back to the old preference.
 */
export const switchLocale = (
  session: E2EBrowserSession,
  locale: SwitchLocale,
  timeouts: Pick<WorkspaceE2ETimeouts, "browserNavigation">
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* activateHydratedElement(session, localeSwitchLinkSelector(locale), {
      timeoutMs: timeouts.browserNavigation,
    });
    yield* waitForPageUrl({
      description: `${locale} locale switch`,
      matches: (url) =>
        parseUrl(url)?.pathname.startsWith(`/${locale}`) ?? false,
      session,
      timeoutMs: timeouts.browserNavigation,
    });
  });
