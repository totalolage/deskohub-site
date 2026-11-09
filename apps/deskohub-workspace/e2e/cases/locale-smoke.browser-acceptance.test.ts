import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  matchSupportedLocale,
  supportedLocales,
  unservedLanguageLocale,
} from "@deskohub/i18n/locale-registry";
import { type Browser, chromium } from "@playwright/test";
import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { E2EBrowserSession } from "../browser-session";
import { runE2ECase } from "../case-runner";
import { formatWorkspaceE2EFailureAnnotation } from "../github-actions";
import { languageMenuMarkup } from "../language-menu.test-utils";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "../services/telemetry.mock";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  assertLocaleSmoke,
  expectedHomeAlternates,
  type LocaleSmokeLocale,
  localeHomeHeading,
  localeSmokeCaseId,
  localeSmokeLocales,
} from "./locale-smoke";

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

type FakeSite = {
  /** The home heading a locale's page renders. */
  readonly heading?: (locale: Locale) => string;
  /** The hreflang alternates every page lists, as hreflang and path. */
  readonly alternates?: readonly (readonly [string, string])[];
  /** Where the root redirects a visitor stating `acceptLanguage`. */
  readonly lands?: (acceptLanguage: string) => string;
};

const productionOrigin = "https://workspace.example";

/**
 * A public site whose root redirects by Accept-Language as the proxy does,
 * and whose locale home pages declare their language, render a heading,
 * list hreflang alternates on the production origin, and offer every other
 * locale in the header language menu.
 */
const serveSite = ({
  alternates = expectedHomeAlternates(),
  heading = localeHomeHeading,
  lands = (acceptLanguage) =>
    `/${matchSupportedLocale(acceptLanguage) ?? unservedLanguageLocale}`,
}: FakeSite) =>
  Bun.serve({
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/")
        return new Response(null, {
          headers: {
            location: new URL(
              lands(request.headers.get("accept-language") ?? ""),
              request.url
            ).href,
          },
          status: 307,
        });
      const locale = supportedLocales.find(
        (candidate) => pathname === `/${candidate}`
      );
      if (!locale) return new Response("Not found", { status: 404 });
      const links = alternates
        .map(
          ([hreflang, path]) =>
            `<link rel="alternate" hreflang="${hreflang}" href="${productionOrigin}${path}">`
        )
        .join("");
      const menu = languageMenuMarkup({
        links: supportedLocales
          .filter((other) => other !== locale)
          .map((other) => ({ href: `/${other}`, label: other })),
      });
      return new Response(
        `<!doctype html><html lang="${locale}"><head>${links}</head><body>
        <main><h1>${heading(locale)}</h1></main>${menu}</body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    },
    hostname: "127.0.0.1",
    port: 0,
  });

/** Runs one locale's smoke case and returns its failure annotations. */
const runLocaleSmoke = async (locale: LocaleSmokeLocale, site: FakeSite) => {
  const opened = browser;
  if (!opened) throw new Error("Chromium is not running");
  const server = serveSite(site);
  const observations: E2ETelemetryObservation[] = [];
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const openSession = yield* E2EBrowserSession.openOnFirstUse({
            browser: opened,
            id: `locale-smoke-${randomUUID()}`,
            recordHar: false,
          });
          yield* Effect.exit(
            runE2ECase({
              body: (runStep) =>
                assertLocaleSmoke({
                  config: {
                    baseUrl: server.url.origin,
                    bypassSecret: undefined,
                    timeouts: {
                      ...workspaceE2ETimeouts,
                      browserAction: 3000,
                      browserNavigation: 3000,
                    },
                  },
                  locale,
                  openSession,
                  runStep,
                }),
              caseId: localeSmokeCaseId(locale),
              watchdogMs: 30_000,
            }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
          );
        })
      )
    );
    const annotations = observations.flatMap((observation) =>
      observation.scope === "annotation" ? [observation] : []
    );
    // CI prints these through the real formatter, which drops any ID it
    // cannot print, so every case and step ID must survive it.
    for (const annotation of annotations) {
      expect(formatWorkspaceE2EFailureAnnotation(annotation)).not.toContain(
        "invalid"
      );
    }
    return annotations.map(({ scope: _scope, ...annotation }) => annotation);
  } finally {
    await server.stop(true);
  }
};

for (const locale of localeSmokeLocales) {
  test.skipIf(!chromiumAvailable)(
    `passes ${locale} on a site that serves it`,
    async () => {
      expect(await runLocaleSmoke(locale, {})).toEqual([]);
    }
  );
}

test.skipIf(!chromiumAvailable)(
  "fails the redirect step when a regional language lands elsewhere",
  async () => {
    const annotations = await runLocaleSmoke("de-DE", {
      lands: (acceptLanguage) =>
        acceptLanguage === "de" ? "/de-DE" : "/en-US",
    });

    expect(annotations).toEqual([
      {
        caseId: "locale-smoke-de-de",
        failureKind: "error",
        outcome: "failed",
        stepId: "redirect-accept-language-de-at",
      },
    ]);
  }
);

test.skipIf(!chromiumAvailable)(
  "times out the heading step when the page falls back to another catalog",
  async () => {
    const annotations = await runLocaleSmoke("sk-SK", {
      heading: (locale) =>
        localeHomeHeading(locale === "sk-SK" ? "cs-CZ" : locale),
    });

    expect(annotations).toEqual([
      {
        caseId: "locale-smoke-sk-sk",
        failureKind: "timeout",
        outcome: "timed_out",
        stepId: "assert-home-heading",
      },
    ]);
  }
);

test.skipIf(!chromiumAvailable)(
  "fails the alternates step when a locale is missing from hreflang",
  async () => {
    const annotations = await runLocaleSmoke("uk-UA", {
      alternates: expectedHomeAlternates().filter(
        ([hreflang]) => hreflang !== "uk-UA"
      ),
    });

    expect(annotations).toEqual([
      {
        caseId: "locale-smoke-uk-ua",
        failureKind: "error",
        outcome: "failed",
        stepId: "assert-hreflang-alternates",
      },
    ]);
  }
);
