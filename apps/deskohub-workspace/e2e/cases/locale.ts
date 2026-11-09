import { Effect } from "effect";
import {
  activateElement,
  activateHydratedElement,
  openPage,
  waitForPageUrl,
  waitForReactHandler,
} from "../browser";
import type {
  E2EBrowserSession,
  OpenE2EBrowserSession,
} from "../browser-session";
import type { WorkspaceE2EStepRunner } from "../case-runner";
import type { WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import { log, parseUrl } from "../runtime";
import type { WorkspaceE2ETimeouts } from "../timeouts";
import type { CheckoutData } from "../types";

export const assertLocaleSwitcher = ({
  config,
  runStep,
  openSession,
}: {
  config: Pick<WorkspaceE2EConfig, "baseUrl" | "bypassSecret" | "timeouts">;
  runStep: WorkspaceE2EStepRunner;
  openSession: OpenE2EBrowserSession;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const browser = openSession;
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

const languageMenuTriggerSelector = "button[data-language-menu-trigger]";
const localeSwitchLinkSelector = (locale: SwitchLocale) =>
  `[data-locale-switcher] a[href^="/${locale}"]`;

/**
 * Switches the locale through the header's language menu: opens it from the
 * keyboard once the trigger's handler has hydrated, then natively activates
 * the hydrated link. For a signed-in visitor the switcher saves the language
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
    yield* waitForReactHandler(
      session,
      languageMenuTriggerSelector,
      "onKeyDown",
      {
        timeoutMs: timeouts.browserNavigation,
      }
    );
    yield* activateElement(session, languageMenuTriggerSelector, {
      timeoutMs: timeouts.browserNavigation,
    });
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
