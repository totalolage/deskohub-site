import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type BrowserContext, chromium } from "@playwright/test";
import { Effect, Exit, Scope } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import {
  browserSessionFor,
  makePlaywrightBrowserRunner,
  type Runner,
} from "./runtime";

// The argv runner is a shim over the browser session until every caller
// drives the session; these pin its commands against a real Chromium.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let artifactDir = "";
const previewProbes: Record<string, string>[] = [];
const rejectedBypassSecret = "synthetic-rejected-runner-bypass";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  artifactDir = await mkdtemp(join(tmpdir(), "browser-runner-test-"));
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/favicon.svg") {
        previewProbes.push(Object.fromEntries(request.headers));
        if (
          request.headers.get("x-vercel-protection-bypass") ===
          rejectedBypassSecret
        )
          return new Response("denied", { status: 401 });
        return new Response("<svg/>", {
          headers: {
            "content-type": "image/svg+xml",
            "set-cookie":
              "_vercel_jwt=synthetic-runner-cookie; Path=/; HttpOnly",
          },
        });
      }
      return new Response(
        pathname === "/popup"
          ? "<!doctype html><title>Popup</title>"
          : `<!doctype html><title>Checkout</title>
            <button id="popup" onclick="window.open('/popup')">Open</button>
            <iframe id="card" srcdoc="<input id='holder' aria-label='Holder'>"></iframe>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    },
  });
});

afterAll(async () => {
  await browser?.close();
  await server?.stop(true);
  if (artifactDir) await rm(artifactDir, { force: true, recursive: true });
});

const origin = () => {
  if (!server) throw new Error("test server is not running");
  return `http://localhost:${server.port}`;
};

const withRunner = async <A>(
  body: (run: Runner) => Promise<A>,
  options: Parameters<typeof makePlaywrightBrowserRunner>[1] = {}
) => {
  if (!browser) throw new Error("Chromium is not running");
  const run = makePlaywrightBrowserRunner(browser, options);
  try {
    return await body(run);
  } finally {
    await run.close?.();
  }
};

const command = async (
  run: Runner,
  session: string,
  args: string[],
  input?: string
) =>
  (
    await run("playwright", ["--session", session, ...args], {
      input,
      logCommand: false,
      logOutput: false,
      timeoutMs: 5000,
    })
  ).stdout;

test.skipIf(!chromiumAvailable)(
  "drives argv commands and the bridged session in one context",
  async () => {
    const session = `bridge-${randomUUID()}`;
    const outcome = await withRunner(async (run) => {
      await command(run, session, ["open", `${origin()}/`]);
      const browserSession = await Effect.runPromise(
        browserSessionFor(run, session)
      );
      const title = await Effect.runPromise(
        browserSession.use("read the title", (page) => page.title())
      );
      await Effect.runPromise(
        browserSession.setSessionCookie({
          name: "session_token",
          url: "https://workspace.example.test",
          value: "synthetic-session-value",
        })
      );
      const cookie = await Effect.runPromise(
        browserSession.describeCookie({
          name: "session_token",
          url: "https://workspace.example.test/en-US",
          value: "synthetic-session-value",
        })
      );
      // Cookies go through the session only; the argv protocol has none.
      const argvCookie = await command(
        run,
        session,
        ["cookie", "get", "--stdin"],
        "{}"
      ).then(
        () => "accepted",
        () => "rejected"
      );
      return { argvCookie, cookie, title };
    });

    expect(outcome.title).toBe("Checkout");
    expect(outcome.argvCookie).toBe("rejected");
    expect(outcome.cookie).toEqual({
      httpOnly: true,
      lifetimeDays: null,
      matches: true,
      path: "/",
      present: true,
      sameSite: "Lax",
      secure: true,
    });
    expect(JSON.stringify(outcome.cookie)).not.toContain(
      "synthetic-session-value"
    );
  }
);

test.skipIf(!chromiumAvailable)(
  "targets the selected frame and switches tabs by id",
  async () => {
    const session = `tabs-${randomUUID()}`;
    const outcome = await withRunner(async (run) => {
      await command(run, session, ["open", `${origin()}/`]);
      await command(run, session, ["frame", "#card"]);
      await command(run, session, ["fill", "#holder", "Synthetic Holder"]);
      const holder = await command(run, session, ["get", "value", "#holder"]);
      await command(run, session, ["frame", "main"]);
      await command(run, session, ["click", "#popup"]);
      const browserSession = await Effect.runPromise(
        run.session?.(session) ?? Effect.die("runner bridge missing")
      );
      await Effect.runPromise(
        browserSession.use("await the popup", async (page) => {
          if (page.context().pages().length < 2)
            await page.context().waitForEvent("page");
        })
      );
      await command(run, session, [
        "wait",
        "--fn",
        "document.readyState === 'complete'",
      ]);
      const tabs = JSON.parse(
        await command(run, session, ["--json", "tab", "list"])
      );
      const popupUrl = await command(run, session, ["get", "url"]);
      await command(run, session, ["tab", "t1"]);
      const checkoutUrl = await command(run, session, ["get", "url"]);
      await command(run, session, ["tab", "close", "t2"]);
      const remaining = JSON.parse(
        await command(run, session, ["--json", "tab", "list"])
      );
      return { checkoutUrl, holder, popupUrl, remaining, tabs };
    });

    expect(outcome.holder).toBe("Synthetic Holder");
    expect(outcome.tabs).toEqual({
      data: {
        tabs: [
          { active: false, tabId: "t1" },
          { active: true, tabId: "t2" },
        ],
      },
      success: true,
    });
    expect(outcome.popupUrl).toBe(`${origin()}/popup`);
    expect(outcome.checkoutUrl).toBe(`${origin()}/`);
    expect(outcome.remaining).toEqual({
      data: { tabs: [{ active: true, tabId: "t1" }] },
      success: true,
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "drops the selected frame when another page becomes active",
  async () => {
    const session = `frame-reset-${randomUUID()}`;
    const afterPopup = await withRunner(async (run) => {
      await command(run, session, ["open", `${origin()}/`]);
      await command(run, session, ["frame", "#card"]);
      const browserSession = await Effect.runPromise(
        run.session?.(session) ?? Effect.die("runner bridge missing")
      );
      await Effect.runPromise(
        browserSession.use("open and close the popup", async (page) => {
          const [popup] = await Promise.all([
            page.waitForEvent("popup"),
            page.click("#popup"),
          ]);
          await popup.close();
        })
      );
      return run(
        "playwright",
        ["--session", session, "get", "value", "#holder"],
        {
          allowFailure: true,
          logCommand: false,
          logOutput: false,
          timeoutMs: 500,
        }
      );
    });

    expect(afterPopup.exitCode).toBe(1);
    expect(afterPopup.stderr).toContain("Timeout 500ms exceeded");
  }
);

test.skipIf(!chromiumAvailable)(
  "no longer serves the capture and HAR commands the session owns",
  async () => {
    const session = `retired-${randomUUID()}`;
    const results = await withRunner(async (run) => {
      await command(run, session, ["open", `${origin()}/`]);
      return Promise.all(
        [
          ["console"],
          ["console", "--clear"],
          ["errors"],
          ["network", "requests", "--clear"],
          ["network", "har", "start"],
          ["network", "har", "stop"],
        ].map((args) =>
          run("playwright", ["--session", session, ...args], {
            allowFailure: true,
            logCommand: false,
            logOutput: false,
          })
        )
      );
    });

    expect(results.map((result) => result.exitCode)).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
  }
);

test.skipIf(!chromiumAvailable)(
  "closes every session with the caller's Scope, one that opens late included",
  async () => {
    if (!browser) throw new Error("Chromium is not running");
    const realBrowser = browser;
    const contextRequested = Promise.withResolvers<void>();
    const contextHeld = Promise.withResolvers<void>();
    const contexts: BrowserContext[] = [];
    // Holds the second context until the Scope has closed.
    const holding = {
      newContext: async (options?: Parameters<Browser["newContext"]>[0]) => {
        const context = await realBrowser.newContext(options);
        contexts.push(context);
        if (contexts.length === 2) {
          contextRequested.resolve();
          await contextHeld.promise;
        }
        return context;
      },
    } as unknown as Browser;
    const scope = Scope.makeUnsafe("parallel");
    const run = makePlaywrightBrowserRunner(holding, {
      recordHar: false,
      scope,
    });
    await command(run, "scoped-first", ["open", `${origin()}/`]);
    const late = run("playwright", ["--session", "scoped-late", "get", "url"], {
      allowFailure: true,
      logCommand: false,
      logOutput: false,
    });
    await contextRequested.promise;

    await Effect.runPromise(Scope.close(scope, Exit.void));
    const [first, lateContext] = contexts;
    const firstClosed = !realBrowser
      .contexts()
      .includes(first as BrowserContext);
    const lateClosed = Promise.withResolvers<void>();
    lateContext?.on("close", () => lateClosed.resolve());
    contextHeld.resolve();
    await lateClosed.promise;

    expect(firstClosed).toBe(true);
    expect((await late).exitCode).toBe(1);
  }
);

test.skipIf(!chromiumAvailable)(
  "bounds an argv close by its command timeout",
  async () => {
    if (!browser) throw new Error("Chromium is not running");
    const realBrowser = browser;
    const held = Promise.withResolvers<void>();
    const contexts: BrowserContext[] = [];
    const stalling = {
      newContext: async (options?: Parameters<Browser["newContext"]>[0]) => {
        const context = await realBrowser.newContext(options);
        contexts.push(context);
        context.close = () => held.promise;
        return context;
      },
    } as unknown as Browser;
    const run = makePlaywrightBrowserRunner(stalling, { recordHar: false });
    try {
      await command(run, "stalled-close", ["open", `${origin()}/`]);
      const startedAt = Date.now();
      const closed = await run(
        "playwright",
        ["--session", "stalled-close", "close"],
        {
          allowFailure: true,
          logCommand: false,
          logOutput: false,
          timeoutMs: 500,
        }
      );

      expect(closed.exitCode).toBe(1);
      expect(closed.stderr).toContain("Timeout 500ms exceeded");
      expect(Date.now() - startedAt).toBeLessThan(5000);
    } finally {
      await Promise.all(
        contexts.map((context) =>
          Reflect.apply(
            Object.getPrototypeOf(context).close as BrowserContext["close"],
            context,
            []
          )
        )
      );
      held.resolve();
    }
  }
);

// A Workspace deployment origin, the only kind that receives the secret. The
// runner's `fetch` sends its probe to the local server, and a route answers
// the navigation, which never leaves the browser.
const deploymentOrigin =
  "https://deskohub-workspace-abc123def-synthetic.vercel.app";

const toLocalServer = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin !== deploymentOrigin)
    throw new Error("The probe left the deployment origin");
  return fetch(new URL(`${url.pathname}${url.search}`, origin()), init);
}) as typeof fetch;

test.skipIf(!chromiumAvailable)(
  "primes preview access from --headers through the session, once per origin",
  async () => {
    previewProbes.length = 0;
    const sessionId = `headers-${randomUUID()}`;
    const bypassArgs = [
      "--headers",
      JSON.stringify({
        "x-vercel-protection-bypass": "synthetic-runner-bypass",
        "x-vercel-set-bypass-cookie": "true",
      }),
    ];
    const { cookies, opened } = await withRunner(
      async (run) => {
        const session = await Effect.runPromise(
          run.session?.(sessionId) ?? Effect.die("no session bridge")
        );
        await Effect.runPromise(
          session.use("answer the deployment", (page) =>
            page.context().route(`${deploymentOrigin}/**`, (route) =>
              route.fulfill({
                body: "<!doctype html><title>Deployment</title>",
                contentType: "text/html",
              })
            )
          )
        );
        const opened = [
          await command(run, sessionId, [
            ...bypassArgs,
            "open",
            `${deploymentOrigin}/en-US`,
          ]),
          await command(run, sessionId, [
            ...bypassArgs,
            "open",
            `${deploymentOrigin}/cs-CZ`,
          ]),
          await command(run, sessionId, [
            ...bypassArgs,
            "open",
            `${origin()}/`,
          ]),
        ];
        const cookies = await Effect.runPromise(
          session.use("read cookies", (page) =>
            page.context().cookies(deploymentOrigin)
          )
        );
        return { cookies, opened };
      },
      { fetch: toLocalServer }
    );

    expect(opened).toEqual([
      `${deploymentOrigin}/en-US`,
      `${deploymentOrigin}/cs-CZ`,
      `${origin()}/`,
    ]);
    expect(previewProbes).toEqual([
      expect.objectContaining({
        "x-vercel-protection-bypass": "synthetic-runner-bypass",
        "x-vercel-set-bypass-cookie": "true",
      }),
    ]);
    expect(cookies.map(({ name }) => name)).toEqual(["_vercel_jwt"]);
  }
);

test.skipIf(!chromiumAvailable)(
  "refuses --headers beyond the preview bypass headers",
  async () => {
    previewProbes.length = 0;
    const result = await withRunner((run) =>
      run(
        "playwright",
        [
          "--session",
          `headers-${randomUUID()}`,
          "--headers",
          JSON.stringify({ "e2e-probe-label": "extra" }),
          "open",
          `${origin()}/`,
        ],
        { allowFailure: true, logCommand: false, logOutput: false }
      )
    );
    expect(result.exitCode).toBe(1);
    expect(previewProbes).toEqual([]);
  }
);

test.skipIf(!chromiumAvailable)(
  "fails closed on a rejected probe without navigating",
  async () => {
    previewProbes.length = 0;
    const sessionId = `rejected-${randomUUID()}`;
    const navigations: string[] = [];
    const result = await withRunner(
      async (run) => {
        const session = await Effect.runPromise(
          run.session?.(sessionId) ?? Effect.die("no session bridge")
        );
        await Effect.runPromise(
          session.use("answer the deployment", (page) =>
            page.context().route(`${deploymentOrigin}/**`, (route) => {
              navigations.push(route.request().url());
              return route.fulfill({
                body: "<!doctype html><title>Deployment</title>",
                contentType: "text/html",
              });
            })
          )
        );
        return run(
          "playwright",
          [
            "--session",
            sessionId,
            "--headers",
            JSON.stringify({
              "x-vercel-protection-bypass": rejectedBypassSecret,
            }),
            "open",
            `${deploymentOrigin}/en-US`,
          ],
          { allowFailure: true, logCommand: false, logOutput: false }
        );
      },
      { fetch: toLocalServer }
    );

    expect(result.exitCode).toBe(1);
    expect(previewProbes).toHaveLength(1);
    expect(navigations).toEqual([]);
  }
);
