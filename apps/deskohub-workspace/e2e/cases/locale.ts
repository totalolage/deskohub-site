import { Effect } from "effect";
import {
  activateBrowserElement,
  openBrowserPage,
  waitForBrowserReactHydration,
  waitForBrowserUrl,
} from "../browser";
import type { WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { log, parseUrl } from "../runtime";
import { getWorkspaceE2ETimeoutMs } from "../timeouts";
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
        { timeoutMs: getWorkspaceE2ETimeoutMs("browserNavigation") }
      ).pipe(Effect.asVoid),
      id: "open-home-page",
      timeoutMs: getWorkspaceE2ETimeoutMs("browserNavigation"),
    });

    for (let cycle = 1; cycle <= 3; cycle += 1) {
      yield* runStep({
        execute: switchLocale(run, session, "cs-CZ", cycle),
        id: `switch-to-czech-${cycle}`,
        timeoutMs: getWorkspaceE2ETimeoutMs("uiTransition"),
      });
      yield* runStep({
        execute: switchLocale(run, session, "en-US", cycle),
        id: `switch-to-english-${cycle}`,
        timeoutMs: getWorkspaceE2ETimeoutMs("uiTransition"),
      });
    }

    log("Locale switch e2e passed");
  });

const activateLocaleSwitchLink = (
  run: Runner,
  session: string,
  locale: CheckoutData["locale"] | "cs-CZ"
) =>
  Effect.gen(function* () {
    const timeoutMs = getWorkspaceE2ETimeoutMs("uiTransition");
    const selector = `nav[aria-label="Language switcher"] a[href^="/${locale}"]`;
    yield* waitForBrowserReactHydration(run, session, selector, { timeoutMs });
    yield* activateBrowserElement(run, session, selector, { timeoutMs });
  });

const switchLocale = (
  run: Runner,
  session: string,
  locale: CheckoutData["locale"] | "cs-CZ",
  cycle: number
) =>
  Effect.gen(function* () {
    yield* activateLocaleSwitchLink(run, session, locale);
    yield* waitForBrowserUrl({
      description: `${locale} locale switch ${cycle}`,
      matches: (url) =>
        parseUrl(url)?.pathname.startsWith(`/${locale}`) ?? false,
      run,
      session,
      timeoutMs: getWorkspaceE2ETimeoutMs("uiTransition"),
    });
  });
