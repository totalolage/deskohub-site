import { Effect } from "effect";
import {
  activateHydratedBrowserElement,
  openBrowserPage,
  waitForBrowserCondition,
  waitForBrowserUrl,
} from "../browser";
import type { WorkspaceE2EStepRunner } from "../case-runner";
import type { WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { log, parseUrl } from "../runtime";
import type { WorkspaceE2ETimeouts } from "../timeouts";
import type { CheckoutData } from "../types";

export const assertLocaleSwitcher = ({
  config,
  run,
  runStep,
  session,
}: {
  config: WorkspaceE2EConfig;
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  session: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* runStep({
      execute: openBrowserPage(
        config,
        run,
        session,
        `${config.baseUrl}/en-US`,
        { timeoutMs: config.timeouts.browserNavigation }
      ).pipe(Effect.asVoid),
      id: "open-home-page",
      timeoutMs: config.timeouts.browserNavigation,
    });

    yield* runStep({
      execute: switchLocale(run, session, "cs-CZ", config.timeouts),
      id: "switch-to-czech",
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* runStep({
      execute: switchLocale(run, session, "en-US", config.timeouts),
      id: "switch-to-english",
      timeoutMs: config.timeouts.browserNavigation,
    });

    log("Locale switch e2e passed");
  });

type SwitchLocale = CheckoutData["locale"] | "cs-CZ";

const localeSwitchLinkSelector = (locale: SwitchLocale) =>
  `[data-locale-switcher] a[href^="/${locale}"]`;

const activateLocaleSwitchLink = (
  run: Runner,
  session: string,
  locale: SwitchLocale,
  timeouts: WorkspaceE2ETimeouts
) =>
  Effect.gen(function* () {
    const timeoutMs = timeouts.browserNavigation;
    yield* activateHydratedBrowserElement(
      run,
      session,
      localeSwitchLinkSelector(locale),
      { timeoutMs }
    );
  });

/**
 * Switches the locale through the header with a native activation of the
 * hydrated link. For a signed-in visitor the switcher saves the language
 * preference before the document navigation, waiting for the streamed
 * session check if needed, so the URL wait also proves the save: without it
 * the proxy would redirect back to the old preference.
 */
export const switchLocale = (
  run: Runner,
  session: string,
  locale: SwitchLocale,
  timeouts: WorkspaceE2ETimeouts
) =>
  Effect.gen(function* () {
    yield* activateLocaleSwitchLink(run, session, locale, timeouts);
    yield* waitForBrowserUrl({
      description: `${locale} locale switch`,
      matches: (url) =>
        parseUrl(url)?.pathname.startsWith(`/${locale}`) ?? false,
      run,
      session,
      timeoutMs: timeouts.browserNavigation,
    });
  });
