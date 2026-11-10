import { supportedLocales } from "@deskohub/i18n/locale-registry";
import { Effect } from "effect";
import { type Locale, m } from "@/features/i18n";
import { openPage, waitForPageCondition } from "../browser";
import type {
  E2EBrowserSession,
  OpenE2EBrowserSession,
} from "../browser-session";
import type { WorkspaceE2EStepRunner } from "../case-runner";
import type { WorkspaceE2EConfig } from "../config";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { log } from "../runtime";
import type { WorkspaceE2ETimeouts } from "../timeouts";
import { assertLanguageRedirect, switchLocale } from "./locale";

/**
 * The locales served after Czech and English. Each gets a smoke case; the
 * `locale-switch` case covers the first two.
 */
export const localeSmokeLocales = [
  "de-DE",
  "uk-UA",
  "sk-SK",
  "vi-VN",
  "hi-IN",
] as const satisfies readonly Locale[];

export type LocaleSmokeLocale = (typeof localeSmokeLocales)[number];

/**
 * A smoke locale's case ID. IDs are lowercase because the CI failure
 * annotation drops any identifier that isn't.
 */
export const localeSmokeCaseId = (locale: LocaleSmokeLocale) =>
  `locale-smoke-${locale.toLowerCase() as Lowercase<LocaleSmokeLocale>}` as const;

/**
 * Per smoke locale: the Accept-Language values a first-time visitor's
 * browser may state that must land on it, and the locale its header
 * language menu switches to. The switches form a cycle, so the menu is also
 * proven to land on each smoke locale.
 */
export const localeSmokePlans: Readonly<
  Record<
    LocaleSmokeLocale,
    {
      readonly acceptLanguages: readonly [string, ...string[]];
      readonly switchesTo: LocaleSmokeLocale;
    }
  >
> = {
  "de-DE": { acceptLanguages: ["de", "de-AT"], switchesTo: "uk-UA" },
  "sk-SK": { acceptLanguages: ["sk"], switchesTo: "vi-VN" },
  "uk-UA": { acceptLanguages: ["uk"], switchesTo: "sk-SK" },
  "vi-VN": { acceptLanguages: ["vi", "vi-VN"], switchesTo: "hi-IN" },
  "hi-IN": { acceptLanguages: ["hi", "hi-IN"], switchesTo: "de-DE" },
};

/** The home heading a locale's catalog renders. */
export const localeHomeHeading = (locale: Locale) =>
  m.landingHeroTitle({}, { locale });

/**
 * The home page's hreflang alternates as hreflang and pathname pairs: one
 * per supported locale at its prefix, plus `x-default` at the root. The
 * hrefs point at the canonical production origin, so only pathnames compare.
 */
export const expectedHomeAlternates = (): readonly (readonly [
  string,
  string,
])[] =>
  [
    ...supportedLocales.map((locale) => [locale, `/${locale}`] as const),
    ["x-default", "/"] as const,
  ].toSorted(([left], [right]) => left.localeCompare(right));

const readHomeAlternates = (
  session: E2EBrowserSession,
  timeoutMs: number
): Effect.Effect<readonly (readonly [string, string])[], WorkspaceE2EError> =>
  session
    .evaluate(
      "read hreflang alternates",
      () =>
        Array.from(
          document.querySelectorAll<HTMLLinkElement>(
            'link[rel="alternate"][hreflang]'
          ),
          (link) =>
            [
              link.getAttribute("hreflang") ?? "",
              new URL(link.href).pathname,
            ] as const
        ),
      undefined,
      { timeoutMs }
    )
    .pipe(
      Effect.map((alternates) =>
        alternates.toSorted(([left], [right]) => left.localeCompare(right))
      )
    );

const formatAlternates = (alternates: readonly (readonly [string, string])[]) =>
  alternates.map(([hreflang, path]) => `${hreflang} ${path}`).join(", ") ||
  "none";

const waitForDocumentLanguage = (
  session: E2EBrowserSession,
  locale: Locale,
  timeouts: Pick<WorkspaceE2ETimeouts, "browserNavigation">
) =>
  waitForPageCondition(
    session,
    `the ${locale} document language`,
    (expected) => document.documentElement.lang === expected,
    locale,
    { timeoutMs: timeouts.browserNavigation }
  );

/**
 * Smoke-tests one locale on the public site as a signed-out visitor: the
 * proxy sends its Accept-Language values to its prefix, its home page
 * declares its language and renders its own catalog's heading rather than a
 * fallback, the page lists every locale as an hreflang alternate, and the
 * header language menu switches to the next smoke locale.
 */
export const assertLocaleSmoke = ({
  config,
  locale,
  openSession,
  runStep,
}: {
  config: Pick<WorkspaceE2EConfig, "baseUrl" | "bypassSecret" | "timeouts">;
  locale: LocaleSmokeLocale;
  openSession: OpenE2EBrowserSession;
  runStep: WorkspaceE2EStepRunner;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const plan = localeSmokePlans[locale];
    const { timeouts } = config;

    for (const acceptLanguage of plan.acceptLanguages) {
      yield* assertLanguageRedirect({
        acceptLanguage,
        config,
        lands: locale,
        runStep,
      });
    }

    yield* runStep({
      execute: Effect.flatMap(openSession, (session) =>
        openPage(session, config, `${config.baseUrl}/${locale}`, {
          timeoutMs: timeouts.browserNavigation,
        })
      ),
      id: "open-home-page",
      timeoutMs: timeouts.browserNavigation,
    });

    yield* runStep({
      execute: Effect.flatMap(openSession, (session) =>
        waitForDocumentLanguage(session, locale, timeouts)
      ),
      id: "assert-document-language",
      timeoutMs: timeouts.browserNavigation,
    });

    yield* runStep({
      execute: Effect.flatMap(openSession, (session) =>
        waitForPageCondition(
          session,
          `the ${locale} home heading`,
          (expected) =>
            document
              .querySelector("h1")
              ?.textContent?.replace(/\s+/g, " ")
              .trim() === expected,
          localeHomeHeading(locale),
          { timeoutMs: timeouts.browserNavigation }
        )
      ),
      id: "assert-home-heading",
      timeoutMs: timeouts.browserNavigation,
    });

    yield* runStep({
      execute: Effect.flatMap(openSession, (session) =>
        readHomeAlternates(session, timeouts.browserAction)
      ).pipe(
        Effect.flatMap((alternates) => {
          const expected = expectedHomeAlternates();
          return formatAlternates(alternates) === formatAlternates(expected)
            ? Effect.void
            : Effect.fail(
                workspaceE2EError(
                  `The ${locale} home page lists hreflang alternates ${formatAlternates(alternates)}, not ${formatAlternates(expected)}`,
                  { operation: "locale.hreflang-alternates" }
                )
              );
        })
      ),
      id: "assert-hreflang-alternates",
      timeoutMs: timeouts.browserAction,
    });

    yield* runStep({
      execute: Effect.flatMap(openSession, (session) =>
        Effect.andThen(
          switchLocale(session, plan.switchesTo, timeouts),
          waitForDocumentLanguage(session, plan.switchesTo, timeouts)
        )
      ),
      id: `switch-to-${plan.switchesTo.toLowerCase()}`,
      timeoutMs: timeouts.browserNavigation,
    });

    log(`Locale smoke ${locale} passed`);
  });
