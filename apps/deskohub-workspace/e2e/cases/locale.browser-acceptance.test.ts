import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type Browser, chromium } from "@playwright/test";
import { Effect } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { E2EBrowserSession } from "../browser-session";
import { runE2ECase } from "../case-runner";
import { languageMenuMarkup } from "../language-menu.test-utils";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "../services/telemetry.mock";
import { workspaceE2ETimeouts } from "../timeouts";
import { assertLocaleSwitcher } from "./locale";

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

/**
 * Home pages whose header language menu links to the other locale.
 * `hydrated: false` leaves the menu's trigger as the server-rendered
 * fallback; `czechLands` is where the Czech link's navigation ends up, and
 * `unservedLands` where the root redirects a Russian-speaking visitor.
 */
const serveHomePages = ({
  czechLands = "/cs-CZ",
  hydrated = true,
  unservedLands = "/en-US",
}: {
  readonly czechLands?: string;
  readonly hydrated?: boolean;
  readonly unservedLands?: string;
}) =>
  Bun.serve({
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/")
        return new Response(null, {
          headers: {
            location:
              request.headers.get("accept-language") === "ru"
                ? unservedLands
                : "/cs-CZ",
          },
          status: 307,
        });
      if (pathname === "/cs-CZ/switch" && czechLands !== "/cs-CZ")
        return new Response(null, {
          headers: { location: czechLands },
          status: 307,
        });
      const other = pathname.startsWith("/cs-CZ") ? "/en-US" : "/cs-CZ/switch";
      return new Response(
        `<!doctype html><p>Home ${pathname}</p>
        ${languageMenuMarkup({ hydrated, links: [{ href: other, label: "Other locale" }] })}`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    },
    hostname: "127.0.0.1",
    port: 0,
  });

/** Runs the locale-switch case over a session opened on its first use. */
const runLocaleCase = async (pages: Parameters<typeof serveHomePages>[0]) => {
  const opened = browser;
  if (!opened) throw new Error("Chromium is not running");
  const server = serveHomePages(pages);
  const observations: E2ETelemetryObservation[] = [];
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const openSession = yield* E2EBrowserSession.openOnFirstUse({
            browser: opened,
            id: `locale-switch-${randomUUID()}`,
            recordHar: false,
          });
          yield* Effect.exit(
            runE2ECase({
              body: (runStep) =>
                assertLocaleSwitcher({
                  config: {
                    baseUrl: server.url.origin,
                    bypassSecret: undefined,
                    timeouts: {
                      ...workspaceE2ETimeouts,
                      browserNavigation: 3000,
                    },
                  },
                  openSession,
                  runStep,
                }),
              caseId: "locale-switch",
              watchdogMs: 30_000,
            }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
          );
        })
      )
    );
    return {
      annotations: observations
        .filter(({ scope }) => scope === "annotation")
        .map(({ scope: _scope, ...annotation }) => annotation),
    };
  } finally {
    await server.stop(true);
  }
};

test.skipIf(!chromiumAvailable)(
  "switches to Czech and back through the header language menu",
  async () => {
    const { annotations } = await runLocaleCase({});

    expect(annotations).toEqual([]);
  }
);

test.skipIf(!chromiumAvailable)(
  "times out the switch while the language menu trigger is not hydrated",
  async () => {
    const { annotations } = await runLocaleCase({ hydrated: false });

    expect(annotations).toEqual([
      {
        caseId: "locale-switch",
        failureKind: "timeout",
        outcome: "timed_out",
        stepId: "switch-to-czech",
      },
    ]);
  }
);

// The URL wait shares its step's budget, so the step deadline ends it first.
test.skipIf(!chromiumAvailable)(
  "times out the switch when the navigation stays in the old locale",
  async () => {
    const { annotations } = await runLocaleCase({
      czechLands: "/en-US/kept",
    });

    expect(annotations).toEqual([
      {
        caseId: "locale-switch",
        failureKind: "timeout",
        outcome: "timed_out",
        stepId: "switch-to-czech",
      },
    ]);
  }
);

test.skipIf(!chromiumAvailable)(
  "fails the redirect step when an unserved language lands on Czech",
  async () => {
    const { annotations } = await runLocaleCase({ unservedLands: "/cs-CZ" });

    expect(annotations).toEqual([
      {
        caseId: "locale-switch",
        failureKind: "error",
        outcome: "failed",
        stepId: "redirect-accept-language-ru",
      },
    ]);
  }
);
