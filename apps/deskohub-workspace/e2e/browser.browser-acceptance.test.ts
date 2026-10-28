import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type Browser, chromium } from "@playwright/test";
import { Cause, Effect, Exit, Option } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import {
  openPage,
  runBrowserCommand,
  waitForBrowserCondition,
  waitForBrowserTextContent,
  waitForPageText,
  waitForPageTextContent,
} from "./browser";
import { E2EBrowserSession } from "./browser-session";
import { isWorkspaceE2ETimeout, type WorkspaceE2EError } from "./errors";
import { addRedaction } from "./redaction";
import { pollUntil } from "./polling";
import { browserSessionFor, makePlaywrightBrowserRunner } from "./runtime";

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
        openPage(session, { bypassSecret: undefined }, server.url.href).pipe(
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
            server.url.href
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
