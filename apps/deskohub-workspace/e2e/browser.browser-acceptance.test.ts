import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type Browser, chromium } from "@playwright/test";
import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import {
  activateBrowserElement,
  activateElement,
  activateHydratedBrowserElement,
  activateHydratedElement,
  assertPageCheck,
  evalBrowserScript,
  openPage,
  readPageText,
  readPageUrl,
  runBrowserCommand,
  scrollBrowserElementIntoView,
  scrollIntoView,
  waitForBrowserCondition,
  waitForBrowserReactHandler,
  waitForBrowserReactHydration,
  waitForBrowserTextContent,
  waitForBrowserUrl,
  waitForPageCondition,
  waitForPageSnapshot,
  waitForPageText,
  waitForPageTextContent,
  waitForPageUrl,
  waitForReactHandler,
  waitForReactHydration,
} from "./browser";
import { E2EBrowserSession } from "./browser-session";
import {
  failedStepAnnotation as failedAnnotation,
  type BrowserStepDriver as HelperDriver,
  runBrowserStep,
} from "./case-runner.browser.test-utils";
import {
  isWorkspaceE2ETimeout,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "./errors";
import { pollUntil } from "./polling";
import { addRedaction } from "./redaction";
import { browserSessionFor, makePlaywrightBrowserRunner } from "./runtime";
import { argvCommandTimeoutMs } from "./timeouts";

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
 * Polls an argv condition wait whose own Playwright budget is shorter than
 * the condition takes, retrying only its timeouts, on a page that sets
 * `window.saleShown` after `showAfterMs`.
 */
const pollSaleCondition = async (condition: string, showAfterMs: number) => {
  if (!browser) throw new Error("Chromium is not running");
  const run = makePlaywrightBrowserRunner(browser, { recordHar: false });
  const id = `browser-condition-${randomUUID()}`;
  let attempts = 0;
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const session = yield* browserSessionFor(run, id);
      yield* session.use("show the page", (page) =>
        page.setContent(
          `<script>setTimeout(() => { window.saleShown = true; }, ${showAfterMs});</script>`
        )
      );
      return yield* pollUntil(
        Effect.suspend(() => {
          attempts += 1;
          return waitForBrowserCondition(run, id, "sale", condition, {
            timeoutMs: 100,
          });
        }).pipe(
          Effect.as(true),
          Effect.catchIf(isWorkspaceE2ETimeout, () => Effect.succeed(undefined))
        ),
        { intervalMs: 10, label: "sale", timeoutMs: 10_000 }
      );
    })
  ).finally(() => run.close?.());
  return { attempts, exit };
};

test.skipIf(!chromiumAvailable)(
  "retries a browser condition that hit its Playwright timeout",
  async () => {
    const { attempts, exit } = await pollSaleCondition(
      "window.saleShown === true",
      500
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(attempts).toBeGreaterThan(1);
  }
);

test.skipIf(!chromiumAvailable)(
  "keeps a non-timeout browser condition failure terminal",
  async () => {
    const { attempts, exit } = await pollSaleCondition(
      "(() => { throw new Error('sale banner missing'); })()",
      0
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) return;
    const failure = Cause.findErrorOption(exit.cause);
    expect(Option.isSome(failure)).toBe(true);
    expect(isWorkspaceE2ETimeout(Option.getOrUndefined(failure))).toBe(false);
    expect(attempts).toBe(1);
  }
);

/** Runs `drive` on a fresh session showing `html`. */
const onPage = <A>(
  html: string,
  drive: (session: E2EBrowserSession) => Effect.Effect<A, WorkspaceE2EError>
) => {
  if (!browser) throw new Error("Chromium is not running");
  const opened = browser;
  return Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* E2EBrowserSession.open({
          browser: opened,
          id: `browser-page-${randomUUID()}`,
        });
        yield* session.use("show the page", (page) => page.setContent(html));
        return yield* drive(session);
      })
    )
  );
};

const isTimeout = <A>(exit: Exit.Exit<A, WorkspaceE2EError>) =>
  Exit.isFailure(exit) &&
  isWorkspaceE2ETimeout(
    Option.getOrUndefined(Cause.findErrorOption(exit.cause))
  );

test.skipIf(!chromiumAvailable)(
  "waits for page text through the session and the argv wrapper alike",
  async () => {
    const html = "<p>Discount APPLIED</p>";
    const found = (session: E2EBrowserSession) =>
      waitForPageTextContent(session, "discount applied", {
        caseSensitive: false,
        timeoutMs: 300,
      });
    const missing = (session: E2EBrowserSession) =>
      waitForPageTextContent(session, "discount applied", { timeoutMs: 300 });

    expect(Exit.isSuccess(await onPage(html, found))).toBe(true);
    expect(isTimeout(await onPage(html, missing))).toBe(true);

    if (!browser) throw new Error("Chromium is not running");
    const run = makePlaywrightBrowserRunner(browser, { recordHar: false });
    const id = `browser-text-${randomUUID()}`;
    const argv = (caseSensitive: boolean) =>
      Effect.runPromiseExit(
        waitForBrowserTextContent(run, id, "discount applied", {
          caseSensitive,
          timeoutMs: 300,
        })
      );
    try {
      await Effect.runPromise(
        Effect.flatMap(browserSessionFor(run, id), (session) =>
          session.use("show the page", (page) => page.setContent(html))
        )
      );
      expect(Exit.isSuccess(await argv(false))).toBe(true);
      expect(isTimeout(await argv(true))).toBe(true);
    } finally {
      await run.close?.();
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "polls page text past failed reads and returns it redacted",
  async () => {
    const secret = `secret-${randomUUID()}`;
    addRedaction(secret, true);
    // The text can't be read until the page restores it.
    const html = `<p>Saved for ${secret}</p><script>
      Object.defineProperty(document.body, "innerText", {
        configurable: true,
        get() { throw new Error("text unavailable"); },
      });
      setTimeout(() => { delete document.body.innerText; }, 1500);
    </script>`;

    const exit = await onPage(html, (session) =>
      waitForPageText({
        description: "saved text",
        matches: (text) => text.includes("Saved for"),
        session,
        timeoutMs: 10_000,
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isFailure(exit)) return;
    expect(exit.value).toContain("Saved for");
    expect(exit.value).not.toContain(secret);
  }
);

test.skipIf(!chromiumAvailable)(
  "times out polling page text that never matches",
  async () => {
    const exit = await onPage("<p>Pending</p>", (session) =>
      waitForPageText({
        description: "saved text",
        matches: (text) => text.includes("Saved"),
        session,
        timeoutMs: 1_500,
      })
    );

    expect(isTimeout(exit)).toBe(true);
  }
);

test.skipIf(!chromiumAvailable)(
  "polls the interactive snapshot past an unopened browser and redacts it",
  async () => {
    const secret = `secret-${randomUUID()}`;
    addRedaction(secret, true);
    const html = `<main></main><script>
      setTimeout(() => {
        document.querySelector("main").innerHTML =
          "<h2>Past reservations</h2><button>Cancel for ${secret}</button>";
      }, 500);
    </script>`;
    let reads = 0;

    const exit = await onPage(html, (session) =>
      waitForPageSnapshot({
        description: "past reservations",
        matches: (snapshot) =>
          snapshot.includes("Past reservations") &&
          snapshot.includes("Cancel for"),
        // The first read finds no browser, as a lane browser that failed to
        // open; the poll keeps reading.
        session: Effect.suspend(() => {
          reads += 1;
          return reads === 1
            ? Effect.fail(workspaceE2EError("open browser session failed"))
            : Effect.succeed(session);
        }),
        timeoutMs: 10_000,
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isFailure(exit)) return;
    expect(reads).toBeGreaterThan(1);
    expect(exit.value).toContain('heading "Past reservations"');
    expect(exit.value).not.toContain(secret);
  }
);

test.skipIf(!chromiumAvailable)(
  "times out polling a snapshot that never matches",
  async () => {
    const exit = await onPage("<h2>Current and upcoming</h2>", (session) =>
      waitForPageSnapshot({
        description: "past reservations",
        matches: (snapshot) => snapshot.includes("Past reservations"),
        session,
        timeoutMs: 1_500,
      })
    );

    expect(isTimeout(exit)).toBe(true);
  }
);

test.skipIf(!chromiumAvailable)(
  "opens a page without priming when the run has no bypass secret",
  async () => {
    const server = Bun.serve({
      fetch: () =>
        new Response("<p>Opened</p>", {
          headers: { "content-type": "text/html" },
        }),
      hostname: "127.0.0.1",
      port: 0,
    });
    try {
      const exit = await onPage("", (session) =>
        openPage(session, { bypassSecret: undefined }, server.url.href, {
          timeoutMs: 10_000,
        }).pipe(
          Effect.andThen(
            waitForPageTextContent(session, "Opened", { timeoutMs: 1_000 })
          )
        )
      );
      expect(Exit.isSuccess(exit)).toBe(true);
    } finally {
      await server.stop(true);
    }
  }
);

// A Workspace deployment origin, the only kind that gets the bypass secret.
// The session's `fetch` answers its probe, and the context answers the page.
const deploymentOrigin =
  "https://deskohub-workspace-abc123def-synthetic.vercel.app";

/**
 * Opens the deployment origin through `openPage` with a bypass secret,
 * recording the probe and the navigation in the order they happen.
 */
const openProtectedPage = async (probeStatus: number) => {
  if (!browser) throw new Error("Chromium is not running");
  const opened = browser;
  const events: string[] = [];
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* E2EBrowserSession.open({
          browser: opened,
          fetch: (async (input: string | URL | Request) => {
            const url = new URL(input instanceof Request ? input.url : input);
            events.push(`probe ${url.origin}`);
            return new Response(null, { status: probeStatus });
          }) as typeof fetch,
          id: `browser-open-${randomUUID()}`,
          recordHar: false,
        });
        yield* session.use("route the deployment", (page) =>
          page.context().route(`${deploymentOrigin}/**`, (route) => {
            events.push(`navigate ${new URL(route.request().url()).origin}`);
            return route.fulfill({
              body: "<p>Opened</p>",
              contentType: "text/html",
            });
          })
        );
        yield* openPage(
          session,
          { bypassSecret: "synthetic-bypass-secret" },
          `${deploymentOrigin}/en-US`,
          { timeoutMs: 5_000 }
        );
        yield* waitForPageTextContent(session, "Opened", { timeoutMs: 1_000 });
      })
    )
  );
  return { events, exit };
};

test.skipIf(!chromiumAvailable)(
  "primes preview access before it opens a protected page",
  async () => {
    const { events, exit } = await openProtectedPage(200);

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(events).toEqual([
      `probe ${deploymentOrigin}`,
      `navigate ${deploymentOrigin}`,
    ]);
  }
);

test.skipIf(!chromiumAvailable)(
  "fails without navigating when preview access is refused",
  async () => {
    const { events, exit } = await openProtectedPage(401);

    expect(Exit.isFailure(exit)).toBe(true);
    expect(isTimeout(exit)).toBe(false);
    expect(events).toEqual([`probe ${deploymentOrigin}`]);
  }
);

test.skipIf(!chromiumAvailable)(
  "drops the argv runner's selected iframe when it opens a page",
  async () => {
    if (!browser) throw new Error("Chromium is not running");
    const server = Bun.serve({
      fetch: () =>
        new Response("<p>Top page</p>", {
          headers: { "content-type": "text/html" },
        }),
      hostname: "127.0.0.1",
      port: 0,
    });
    const run = makePlaywrightBrowserRunner(browser, { recordHar: false });
    const id = `browser-frame-${randomUUID()}`;
    try {
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const session = yield* browserSessionFor(run, id);
          yield* session.use("show a framed page", (page) =>
            page.setContent(
              `<iframe id="child" srcdoc="<p>Inside the frame</p>"></iframe>`
            )
          );
          yield* runBrowserCommand("select the iframe", run, id, [
            "frame",
            "#child",
          ]);
          yield* openPage(
            session,
            { bypassSecret: undefined },
            server.url.href,
            { timeoutMs: 10_000 }
          );
          // An argv command after the open reads the new page, not the
          // iframe it had selected on the old one.
          yield* waitForBrowserTextContent(run, id, "Top page", {
            timeoutMs: 1_000,
          });
        })
      );
      expect(Exit.isSuccess(exit)).toBe(true);
    } finally {
      await run.close?.();
      await server.stop(true);
    }
  }
);

// Shared waits that replace argv helpers: each runs as a C03 step through
// both drivers on the same page, so annotations can be compared.

const helperServer = Bun.serve({
  fetch: () =>
    new Response("<!doctype html><html><body></body></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  port: 0,
});

afterAll(() => helperServer.stop(true));

/**
 * Serves a blank page, shows `html` in it, and runs `drive` as the one step
 * of a C03 case (`runBrowserStep`).
 */
const runHelperStep = <A>(
  html: string,
  drive: (driver: HelperDriver) => Effect.Effect<A, WorkspaceE2EError>,
  {
    afterStep,
    stepTimeoutMs,
  }: {
    /** Runs on the page once the case has settled. */
    readonly afterStep?: (
      driver: HelperDriver
    ) => Effect.Effect<void, WorkspaceE2EError>;
    readonly stepTimeoutMs?: number;
  } = {}
) => {
  if (!browser) throw new Error("Chromium is not running");
  return runBrowserStep({
    afterStep,
    browser,
    drive,
    prepare: (session) =>
      session.use("show the page", async (page) => {
        await page.goto(helperServer.url.href);
        await page.setContent(html);
      }),
    stepTimeoutMs,
  });
};

// A control that React hydrates after `afterMs`: it gains React props with
// the given handlers, as React's own `__reactProps$` key carries them.
const hydratingButton = (afterMs: number, handlers: readonly string[] = []) =>
  `<button id="target">Go</button><button id="other">Other</button>
  <script>
    window.presses = 0;
    window.trustedEnters = 0;
    document.getElementById("target").addEventListener("keydown", (event) => {
      if (event.isTrusted && event.key === "Enter") window.trustedEnters += 1;
    });
    document.getElementById("target").addEventListener("click", () => {
      window.presses += 1;
    });
    setTimeout(() => {
      document.getElementById("target").__reactProps$test = Object.fromEntries(
        ${JSON.stringify(handlers)}.map((name) => [name, () => {}])
      );
    }, ${afterMs});
  </script>`;

test.skipIf(!chromiumAvailable)(
  "waits for React hydration and handlers through the session and the argv wrapper alike",
  async () => {
    const html = hydratingButton(300, ["onClick"]);
    const passing = [
      ({ session }: HelperDriver) =>
        waitForReactHydration(session, "#target", { timeoutMs: 5000 }),
      ({ id, run }: HelperDriver) =>
        waitForBrowserReactHydration(run, id, "#target", { timeoutMs: 5000 }),
      ({ session }: HelperDriver) =>
        waitForReactHandler(session, "#target", "onClick", {
          timeoutMs: 5000,
        }),
      ({ id, run }: HelperDriver) =>
        waitForBrowserReactHandler(run, id, "#target", "onClick", {
          timeoutMs: 5000,
        }),
    ];
    for (const drive of passing) {
      const result = await runHelperStep(html, drive);
      expect(result.succeeded).toBe(true);
      expect(result.annotations).toEqual([]);
    }

    // A handler React never attaches, and an element React never hydrates,
    // both time out on their own Playwright budget.
    const timingOut = [
      ({ session }: HelperDriver) =>
        waitForReactHandler(session, "#target", "onChange", {
          timeoutMs: 1000,
        }),
      ({ id, run }: HelperDriver) =>
        waitForBrowserReactHandler(run, id, "#target", "onChange", {
          timeoutMs: 1000,
        }),
      ({ session }: HelperDriver) =>
        waitForReactHydration(session, "#other", {
          timeoutMs: 1000,
        }),
      ({ id, run }: HelperDriver) =>
        waitForBrowserReactHydration(run, id, "#other", {
          timeoutMs: 1000,
        }),
    ];
    for (const drive of timingOut) {
      const result = await runHelperStep(html, drive);
      expect(result.annotations).toEqual(failedAnnotation("timeout"));
      expect(result.failures.map(({ timeout }) => timeout)).toEqual([true]);
    }
  },
  90_000
);

test.skipIf(!chromiumAvailable)(
  "activates a hydrated element with a trusted Enter through both drivers",
  async () => {
    const readPresses = (session: E2EBrowserSession) =>
      session.evaluate(
        "read presses",
        () => ({
          presses: Reflect.get(window, "presses"),
          trustedEnters: Reflect.get(window, "trustedEnters"),
        }),
        undefined,
        { timeoutMs: 5000 }
      );
    for (const drive of [
      ({ session }: HelperDriver) =>
        Effect.andThen(
          activateHydratedElement(session, "#target", { timeoutMs: 5000 }),
          readPresses(session)
        ),
      ({ id, run, session }: HelperDriver) =>
        Effect.andThen(
          activateHydratedBrowserElement(run, id, "#target", {
            timeoutMs: 5000,
          }),
          readPresses(session)
        ),
    ]) {
      const result = await runHelperStep(hydratingButton(300), drive);
      expect(result.succeeded).toBe(true);
      expect(result.value).toEqual({ presses: 1, trustedEnters: 1 });
    }

    for (const drive of [
      ({ session }: HelperDriver) =>
        activateHydratedElement(session, "#missing", { timeoutMs: 1000 }),
      ({ id, run }: HelperDriver) =>
        activateHydratedBrowserElement(run, id, "#missing", {
          timeoutMs: 1000,
        }),
    ]) {
      const result = await runHelperStep(hydratingButton(300), drive);
      expect(result.annotations).toEqual(failedAnnotation("timeout"));
    }
  },
  90_000
);

test.skipIf(!chromiumAvailable)(
  "activates a visible element without waiting for hydration through both drivers",
  async () => {
    const readPresses = (session: E2EBrowserSession) =>
      session.evaluate(
        "read presses",
        () => ({
          presses: Reflect.get(window, "presses"),
          trustedEnters: Reflect.get(window, "trustedEnters"),
        }),
        undefined,
        { timeoutMs: 5000 }
      );
    // The button never hydrates within the test.
    const html = hydratingButton(120_000);
    for (const drive of [
      ({ session }: HelperDriver) =>
        Effect.andThen(
          activateElement(session, "#target", { timeoutMs: 5000 }),
          readPresses(session)
        ),
      ({ id, run, session }: HelperDriver) =>
        Effect.andThen(
          activateBrowserElement(run, id, "#target", { timeoutMs: 5000 }),
          readPresses(session)
        ),
    ]) {
      const result = await runHelperStep(html, drive);
      expect(result.succeeded).toBe(true);
      expect(result.value).toEqual({ presses: 1, trustedEnters: 1 });
    }

    // Only a hidden match: neither driver focuses it.
    const hidden = `${html}<button id="hidden" hidden>Hidden</button>`;
    for (const drive of [
      ({ session }: HelperDriver) =>
        activateElement(session, "#hidden", { timeoutMs: 1000 }),
      ({ id, run }: HelperDriver) =>
        activateBrowserElement(run, id, "#hidden", { timeoutMs: 1000 }),
    ]) {
      const result = await runHelperStep(hidden, drive);
      expect(result.annotations).toEqual(failedAnnotation("timeout"));
    }
  },
  90_000
);

test.skipIf(!chromiumAvailable)(
  "classifies page checks as the argv assertion evaluation does",
  async () => {
    const blockFor = 2000;
    const checks: readonly {
      readonly argv: string;
      readonly check: (ms: number) => string | null;
      readonly message: string;
    }[] = [
      {
        // The argv form threw the problem the session check returns.
        argv: "(() => { throw new Error('summary missing'); })()",
        check: () => "summary missing",
        message: "check the page failed: summary missing",
      },
      {
        argv: "(() => { throw new Error('broken check'); })()",
        check: (): string | null => {
          throw new Error("broken check");
        },
        message: "check the page failed",
      },
      {
        // Overruns the evaluation bound.
        argv: inPageExpression((ms: number) => {
          const end = Date.now() + ms;
          while (Date.now() < end) {
            // block the page
          }
          return true;
        }, blockFor),
        check: (ms: number) => {
          const end = Date.now() + ms;
          while (Date.now() < end) {
            // block the page
          }
          return null;
        },
        message: "check the page failed",
      },
    ];
    for (const { argv, check, message } of checks) {
      const checked = await runHelperStep("<main></main>", ({ session }) =>
        assertPageCheck(session, "check the page", check, blockFor, {
          timeoutMs: 500,
        })
      );
      expect(checked.annotations).toEqual(failedAnnotation("error"));
      expect(checked.failures).toEqual([{ message, timeout: false }]);

      const argvRun = await runHelperStep("<main></main>", ({ id, run }) =>
        evalBrowserScript("check the page", run, id, argv, { timeoutMs: 500 })
      );
      expect(argvRun.annotations).toEqual(failedAnnotation("error"));
      expect(argvRun.failures.map(({ timeout }) => timeout)).toEqual([false]);
    }

    const holds = await runHelperStep("<main></main>", ({ session }) =>
      assertPageCheck(session, "check the page", () => null, undefined, {
        timeoutMs: 5000,
      })
    );
    expect(holds.succeeded).toBe(true);
    expect(holds.annotations).toEqual([]);
  },
  120_000
);

test.skipIf(!chromiumAvailable)(
  "presses nothing once a step deadline interrupts the hydration wait",
  async () => {
    let presses: number | undefined;
    const result = await runHelperStep(
      hydratingButton(2500),
      ({ session }) =>
        activateHydratedElement(session, "#target", { timeoutMs: 10_000 }),
      {
        // Past the hydration the interrupted wait was still waiting for.
        afterStep: ({ session }) =>
          Effect.gen(function* () {
            yield* Effect.promise(() => Bun.sleep(3500));
            presses = yield* session.evaluate(
              "read presses",
              () => Reflect.get(window, "presses"),
              undefined,
              { timeoutMs: 5000 }
            );
          }),
        stepTimeoutMs: 1000,
      }
    );

    expect(result.annotations).toEqual(failedAnnotation("timeout"));
    expect(presses).toBe(0);
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "classifies page conditions as the argv condition wait does",
  async () => {
    const html = `<p id="state">pending</p>
      <script>setTimeout(() => { document.getElementById("state").textContent = "ready"; }, 300);</script>`;
    const isReady = (selector: string) =>
      document.querySelector(selector)?.textContent === "ready";
    const throwing = (selector: string) => {
      if (document.querySelector(selector)) throw new Error("not ready");
      return false;
    };
    const cases = [
      { expected: [], fn: isReady, selector: "#state", timeoutMs: 5000 },
      {
        expected: failedAnnotation("timeout"),
        fn: isReady,
        selector: "#missing",
        timeoutMs: 1000,
      },
      {
        expected: failedAnnotation("error"),
        fn: throwing,
        selector: "#state",
        timeoutMs: 5000,
      },
    ];
    for (const { expected, fn, selector, timeoutMs } of cases) {
      const session = await runHelperStep(html, ({ session }) =>
        waitForPageCondition(session, "state", fn, selector, { timeoutMs })
      );
      const argvResult = await runHelperStep(html, ({ id, run }) =>
        waitForBrowserCondition(
          run,
          id,
          "state",
          inPageExpression(fn, selector),
          { timeoutMs }
        )
      );
      expect(session.annotations).toEqual(expected);
      expect(argvResult.annotations).toEqual(expected);
    }
  },
  90_000
);

const inPageExpression = <Arg>(fn: (arg: Arg) => unknown, arg: Arg) =>
  `(${fn.toString()})(${JSON.stringify(arg)})`;

test.skipIf(!chromiumAvailable)(
  "scrolls an element into view and fails a missing one through both drivers",
  async () => {
    const html = `<div style="height: 4000px"></div><button id="target">Go</button>`;
    const readTop = (session: E2EBrowserSession) =>
      session.evaluate(
        "read target position",
        () => {
          const target = document.getElementById("target");
          if (!target) throw new Error("target missing");
          const { top } = target.getBoundingClientRect();
          return top > 0 && top < window.innerHeight;
        },
        undefined,
        { timeoutMs: 5000 }
      );
    for (const drive of [
      ({ session }: HelperDriver) =>
        Effect.andThen(
          scrollIntoView(session, "#target", { timeoutMs: 5000 }),
          readTop(session)
        ),
      ({ id, run, session }: HelperDriver) =>
        Effect.andThen(
          scrollBrowserElementIntoView(run, id, "#target", {
            timeoutMs: 5000,
          }),
          readTop(session)
        ),
    ]) {
      const result = await runHelperStep(html, drive);
      expect(result.value).toBe(true);
    }

    for (const drive of [
      ({ session }: HelperDriver) =>
        scrollIntoView(session, "#missing", { timeoutMs: 5000 }),
      ({ id, run }: HelperDriver) =>
        scrollBrowserElementIntoView(run, id, "#missing", {
          timeoutMs: 5000,
        }),
    ]) {
      const result = await runHelperStep(html, drive);
      expect(result.annotations).toEqual(failedAnnotation("error"));
    }
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "fails a scroll whose evaluation overruns its bound instead of timing out",
  async () => {
    // The page never yields to the two animation frames the scroll waits for.
    const html = `<button id="target">Go</button>
      <script>window.requestAnimationFrame = () => 0;</script>`;
    for (const drive of [
      ({ session }: HelperDriver) =>
        scrollIntoView(session, "#target", { timeoutMs: 500 }),
      ({ id, run }: HelperDriver) =>
        scrollBrowserElementIntoView(run, id, "#target", { timeoutMs: 500 }),
    ]) {
      const result = await runHelperStep(html, drive);
      expect(result.annotations).toEqual(failedAnnotation("error"));
      expect(result.failures.map(({ timeout }) => timeout)).toEqual([false]);
    }
  },
  60_000
);

const movingUrlPage = (token: string) => `<script>
  setTimeout(() => history.pushState(null, "", "/reached?token=${token}"), 300);
</script>`;

test.skipIf(!chromiumAvailable)(
  "waits for the page URL redacted through the session and the argv wrapper alike",
  async () => {
    const token = `url-token-${randomUUID()}`;
    addRedaction(token, true);
    for (const wait of [
      (driver: HelperDriver, matches: (url: string) => boolean) =>
        waitForPageUrl({
          description: "reached page",
          matches,
          session: driver.session,
          timeoutMs: 5000,
        }),
      (driver: HelperDriver, matches: (url: string) => boolean) =>
        waitForBrowserUrl({
          description: "reached page",
          matches,
          run: driver.run,
          session: driver.id,
          timeoutMs: 5000,
        }),
    ]) {
      const seen: string[] = [];
      const result = await runHelperStep(movingUrlPage(token), (driver) =>
        wait(driver, (url) => {
          seen.push(url);
          return new URL(url).pathname === "/reached";
        })
      );
      expect(result.succeeded).toBe(true);
      expect(result.value).toContain("/reached?token=");
      expect(result.value).not.toContain(token);
      expect(seen.join("\n")).not.toContain(token);
    }

    const read = await runHelperStep(movingUrlPage(token), ({ session }) =>
      Effect.andThen(
        Effect.promise(() => Bun.sleep(600)),
        readPageUrl(session)
      )
    );
    expect(read.value).toContain("/reached?token=");
    expect(read.value).not.toContain(token);
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "fails a page URL wait that runs out as an error with page diagnostics",
  async () => {
    const results = [];
    for (const wait of [
      ({ session }: HelperDriver) =>
        waitForPageUrl({
          description: "never reached page",
          matches: () => false,
          session,
          timeoutMs: 1500,
        }),
      ({ id, run }: HelperDriver) =>
        waitForBrowserUrl({
          description: "never reached page",
          matches: () => false,
          run,
          session: id,
          timeoutMs: 1500,
        }),
    ]) {
      results.push(await runHelperStep("<h1>Pay</h1>", wait));
    }
    for (const result of results) {
      expect(result.annotations).toEqual(failedAnnotation("error"));
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.timeout).toBe(false);
      expect(result.failures[0]?.message).toStartWith(
        "never reached page failed: Timed out waiting for never reached page"
      );
      expect(result.failures[0]?.message).toContain("Browser diagnostics:\n{");
    }
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "bounds the diagnostics read of a URL wait that ran out on a hung page",
  async () => {
    if (!browser) throw new Error("Chromium is not running");
    const opened = browser;
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* E2EBrowserSession.open({
            browser: opened,
            id: `browser-hung-${randomUUID()}`,
          });
          yield* session.use("hang the page", async (page) => {
            await page.goto(helperServer.url.href);
            // The page's main thread never returns, so no evaluation does.
            await page.evaluate(() => {
              setTimeout(() => {
                for (;;) {
                  // spin
                }
              }, 0);
            });
          });
          const waiting = yield* Effect.forkDetach(
            waitForPageUrl({
              description: "hung page",
              matches: () => false,
              session,
              timeoutMs: 1000,
            }).pipe(Effect.flip)
          );
          yield* TestClock.adjust("1001 millis");
          // Real time lets the diagnostics evaluation reach the hung page.
          yield* Effect.promise(() => Bun.sleep(500));
          yield* TestClock.adjust(`${argvCommandTimeoutMs - 1000} millis`);
          yield* Effect.promise(() => Bun.sleep(200));
          const waitingBeforeBound = waiting.pollUnsafe() === undefined;
          yield* TestClock.adjust("2 seconds");
          const failure = yield* Effect.raceFirst(
            Fiber.join(waiting),
            Effect.promise(() => Bun.sleep(5000)).pipe(Effect.as(undefined))
          );
          return { failure, waitingBeforeBound };
        })
      ).pipe(Effect.provide(TestClock.layer()))
    );

    expect(observed.waitingBeforeBound).toBe(true);
    expect(observed.failure?.message).toEndWith(
      "\nBrowser diagnostics unavailable"
    );
    expect(isWorkspaceE2ETimeout(observed.failure)).toBe(false);
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "reads the page text redacted and fails a read that overruns its bound",
  async () => {
    if (!browser) throw new Error("Chromium is not running");
    const opened = browser;
    const secret = `page-text-secret-${randomUUID()}`;
    addRedaction(secret, true);
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* E2EBrowserSession.open({
            browser: opened,
            id: `browser-text-${randomUUID()}`,
          });
          yield* session.use("show the page", async (page) => {
            await page.goto(helperServer.url.href);
            await page.setContent(`<p>Visible ${secret}</p>`);
          });
          const text = yield* readPageText(session);
          yield* session.use("hang the page", (page) =>
            // The page's main thread never returns, so no evaluation does.
            page.evaluate(() => {
              setTimeout(() => {
                for (;;) {
                  // spin
                }
              }, 0);
            })
          );
          const reading = yield* Effect.forkDetach(
            readPageText(session).pipe(Effect.flip)
          );
          // Real time lets the evaluation reach the hung page.
          yield* Effect.promise(() => Bun.sleep(500));
          yield* TestClock.adjust("29 seconds");
          yield* Effect.promise(() => Bun.sleep(200));
          const readingBeforeBound = reading.pollUnsafe() === undefined;
          yield* TestClock.adjust("2 seconds");
          const failure = yield* Effect.raceFirst(
            Fiber.join(reading),
            Effect.promise(() => Bun.sleep(5000)).pipe(Effect.as(undefined))
          );
          return { failure, readingBeforeBound, text };
        })
      ).pipe(Effect.provide(TestClock.layer()))
    );

    expect(observed.text).toBe("Visible [redacted]");
    expect(observed.readingBeforeBound).toBe(true);
    expect(observed.failure?.operation).toBe("read browser text");
    expect(isWorkspaceE2ETimeout(observed.failure)).toBe(false);
  },
  60_000
);
