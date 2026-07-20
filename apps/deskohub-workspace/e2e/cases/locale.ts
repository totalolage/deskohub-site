import { Effect } from "effect";
import {
  focusBrowserElement,
  openBrowserPage,
  pressBrowserKey,
  requireSnapshotRef,
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

const clickLocaleSwitchLink = (
  run: Runner,
  session: string,
  locale: CheckoutData["locale"] | "cs-CZ"
) =>
  Effect.gen(function* () {
    const timeoutMs = getWorkspaceE2ETimeoutMs("uiTransition");
    yield* waitForBrowserReactHydration(
      run,
      session,
      'nav[aria-label="Language switcher"] a',
      { timeoutMs }
    );
    const ref = yield* requireSnapshotRef({
      description: `${locale} locale switch link`,
      labels: [locale === "cs-CZ" ? "CZECH" : "ENGLISH"],
      role: "link",
      run,
      session,
      timeoutMs,
    });
    yield* focusBrowserElement(run, session, ref, { timeoutMs });
    yield* pressBrowserKey(run, session, "Enter", { timeoutMs });
  });

const switchLocale = (
  run: Runner,
  session: string,
  locale: CheckoutData["locale"] | "cs-CZ",
  cycle: number
) =>
  Effect.gen(function* () {
    yield* clickLocaleSwitchLink(run, session, locale);
    yield* waitForBrowserUrl({
      description: `${locale} locale switch ${cycle}`,
      matches: (url) =>
        parseUrl(url)?.pathname.startsWith(`/${locale}`) ?? false,
      run,
      session,
      timeoutMs: getWorkspaceE2ETimeoutMs("uiTransition"),
    });
  });
