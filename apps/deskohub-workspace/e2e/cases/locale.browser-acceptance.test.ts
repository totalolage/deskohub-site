import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type Browser, chromium } from "@playwright/test";
import { Effect } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { runE2ECase } from "../case-runner";
import { makePlaywrightBrowserRunner } from "../runtime";
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
 * Home pages whose header links to the other locale. `hydrated: false`
 * leaves the links without React props; `czechLands` is where the Czech
 * link's navigation ends up.
 */
const serveHomePages = ({
  czechLands = "/cs-CZ",
  hydrated = true,
}: {
  readonly czechLands?: string;
  readonly hydrated?: boolean;
}) =>
  Bun.serve({
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/cs-CZ/switch" && czechLands !== "/cs-CZ")
        return new Response(null, {
          headers: { location: czechLands },
          status: 307,
        });
      const other = pathname.startsWith("/cs-CZ") ? "/en-US" : "/cs-CZ/switch";
      return new Response(
        `<!doctype html><p>Home ${pathname}</p>
        <nav data-locale-switcher><a href="${other}">Other locale</a></nav>
        ${hydrated ? `<script>document.querySelector("[data-locale-switcher] a").__reactProps$test = { onClick: () => {} };</script>` : ""}`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    },
    hostname: "127.0.0.1",
    port: 0,
  });

/** Runs the locale-switch case over the real argv runner. */
const runLocaleCase = async (pages: Parameters<typeof serveHomePages>[0]) => {
  if (!browser) throw new Error("Chromium is not running");
  const server = serveHomePages(pages);
  const run = makePlaywrightBrowserRunner(browser, { recordHar: false });
  const observations: E2ETelemetryObservation[] = [];
  try {
    await Effect.runPromiseExit(
      runE2ECase({
        body: (runStep) =>
          assertLocaleSwitcher({
            config: {
              baseUrl: server.url.origin,
              bypassSecret: undefined,
              timeouts: { ...workspaceE2ETimeouts, browserNavigation: 3000 },
            },
            run,
            runStep,
            session: `locale-switch-${randomUUID()}`,
          }),
        caseId: "locale-switch",
        watchdogMs: 30_000,
      }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
    );
    return {
      annotations: observations
        .filter(({ scope }) => scope === "annotation")
        .map(({ scope: _scope, ...annotation }) => annotation),
    };
  } finally {
    await run.close?.();
    await server.stop(true);
  }
};

test.skipIf(!chromiumAvailable)(
  "switches to Czech and back through the header links",
  async () => {
    const { annotations } = await runLocaleCase({});

    expect(annotations).toEqual([]);
  }
);

test.skipIf(!chromiumAvailable)(
  "times out the switch while the locale link is not hydrated",
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
