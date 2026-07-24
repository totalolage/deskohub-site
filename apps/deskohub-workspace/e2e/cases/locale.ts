import { Effect } from "effect";
import {
  activateHydratedBrowserElement,
  openBrowserPage,
  waitForBrowserUrl,
} from "../browser";
import type { WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { log, parseUrl } from "../runtime";
import type { WorkspaceE2ETimeouts } from "../timeouts";
import type { CheckoutData, WorkspaceE2EStepRunner } from "../types";

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

    for (let cycle = 1; cycle <= 3; cycle += 1) {
      yield* runStep({
        execute: switchLocale(run, session, "cs-CZ", cycle, config.timeouts),
        id: `switch-to-czech-${cycle}`,
        timeoutMs: config.timeouts.browserNavigation,
      });
      yield* runStep({
        execute: switchLocale(run, session, "en-US", cycle, config.timeouts),
        id: `switch-to-english-${cycle}`,
        timeoutMs: config.timeouts.browserNavigation,
      });
    }

    log("Locale switch e2e passed");
  });

const activateLocaleSwitchLink = (
  run: Runner,
  session: string,
  locale: CheckoutData["locale"] | "cs-CZ",
  timeouts: WorkspaceE2ETimeouts
) =>
  Effect.gen(function* () {
    const timeoutMs = timeouts.browserNavigation;
    const selector = `nav[aria-label="Language switcher"] a[href^="/${locale}"]`;
    yield* activateHydratedBrowserElement(run, session, selector, {
      timeoutMs,
    });
  });

const switchLocale = (
  run: Runner,
  session: string,
  locale: CheckoutData["locale"] | "cs-CZ",
  cycle: number,
  timeouts: WorkspaceE2ETimeouts
) =>
  Effect.gen(function* () {
    yield* activateLocaleSwitchLink(run, session, locale, timeouts);
    yield* waitForBrowserUrl({
      description: `${locale} locale switch ${cycle}`,
      matches: (url) =>
        parseUrl(url)?.pathname.startsWith(`/${locale}`) ?? false,
      run,
      session,
      timeoutMs: timeouts.browserNavigation,
    });
  });
