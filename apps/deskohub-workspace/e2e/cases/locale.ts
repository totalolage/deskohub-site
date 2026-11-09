import { unservedLanguageLocale } from "@deskohub/i18n/locale-registry";
import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
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
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { log, parseUrl } from "../runtime";
import type { WorkspaceE2ETimeouts } from "../timeouts";

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
    yield* assertLanguageRedirect({
      acceptLanguage: "ru",
      config,
      lands: unservedLanguageLocale,
      runStep,
    });
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

const languageRedirectOperation = "locale.accept-language-redirect";

/**
 * Requests the unprefixed home page as a first-time visitor whose browser
 * states `acceptLanguage`, and checks the proxy redirects it to `lands`. The
 * request runs outside the browser so no locale cookie from an earlier visit
 * takes precedence, and it leaves the redirect unfollowed to read where it
 * points. A failed request reports neither its headers nor its cause, which
 * could echo the bypass secret.
 */
export const assertLanguageRedirect = ({
  acceptLanguage,
  config,
  lands,
  runStep,
}: {
  acceptLanguage: string;
  config: Pick<WorkspaceE2EConfig, "baseUrl" | "bypassSecret" | "timeouts">;
  lands: Locale;
  runStep: WorkspaceE2EStepRunner;
}): Effect.Effect<void, WorkspaceE2EError> =>
  runStep({
    execute: Effect.tryPromise({
      catch: () =>
        workspaceE2EError(
          `The home page request with Accept-Language ${acceptLanguage} failed`,
          { operation: languageRedirectOperation }
        ),
      try: async (signal) => {
        const response = await fetch(new URL("/", config.baseUrl), {
          headers: {
            "accept-language": acceptLanguage,
            ...(config.bypassSecret
              ? { "x-vercel-protection-bypass": config.bypassSecret }
              : {}),
          },
          redirect: "manual",
          signal,
        });
        await response.body?.cancel();
        const location = response.headers.get("location");
        return {
          landedOn:
            location === null
              ? undefined
              : new URL(location, config.baseUrl).pathname,
          status: response.status,
        };
      },
    }).pipe(
      Effect.flatMap(({ landedOn, status }) =>
        status >= 300 && status < 400 && landedOn === `/${lands}`
          ? Effect.void
          : Effect.fail(
              workspaceE2EError(
                `Accept-Language ${acceptLanguage} answered ${status} to ${landedOn ?? "no location"}, not /${lands}`,
                { operation: languageRedirectOperation }
              )
            )
      )
    ),
    id: `redirect-accept-language-${acceptLanguage.toLowerCase()}`,
    timeoutMs: config.timeouts.browserAction,
  });

const languageMenuTriggerSelector = "button[data-language-menu-trigger]";
const localeSwitchLinkSelector = (locale: Locale) =>
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
  locale: Locale,
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
