import { afterAll, beforeAll, expect, test } from "bun:test";
import { ok } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type BrowserContext, chromium } from "@playwright/test";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { E2EBrowserSession } from "./browser-session";
import {
  formatWorkspaceE2EFailure,
  isWorkspaceE2ETimeout,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "./errors";
import { addRedaction } from "./redaction";
import { workspaceE2ETimeouts } from "./timeouts";

// The session owns what Playwright does not, so these run against a real
// Chromium and a local server instead of a scripted adapter.
const chromiumAvailable = await playwrightChromiumAvailable();
const acceptedBypassSecret = "synthetic-accepted-bypass-secret";
let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let artifactDir = "";
const bypassProbes: (string | null)[] = [];
let heldProbe: PromiseWithResolvers<Response> | undefined;
let heldProbeArrived: PromiseWithResolvers<void> | undefined;
let heldProbeAborted = false;

const html = (body: string) =>
  new Response(`<!doctype html><html lang="en">${body}</html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

beforeAll(async () => {
  if (!chromiumAvailable) return;
  artifactDir = await mkdtemp(join(tmpdir(), "browser-session-test-"));
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      switch (url.pathname) {
        case "/":
          return html(
            `<head><title>Session</title></head><body><button id="popup" onclick="window.open('/popup')">Open</button></body>`
          );
        case "/popup":
          return html(`<head><title>Popup</title></head><body></body>`);
        case "/noisy": {
          const count = Number(url.searchParams.get("count"));
          return html(
            `<body><h1>Noisy</h1><script>
              for (let index = 0; index < ${count}; index += 1) console.log("entry " + index);
              console.log("${url.searchParams.get("echo") ?? ""}");
              setTimeout(() => { throw new Error("synthetic page failure"); });
            </script></body>`
          );
        }
        case "/favicon.svg": {
          const secret = request.headers.get("x-vercel-protection-bypass");
          bypassProbes.push(secret);
          if (secret === "synthetic-held-secret" && heldProbe) {
            request.signal.addEventListener("abort", () => {
              heldProbeAborted = true;
            });
            heldProbeArrived?.resolve();
            return heldProbe.promise;
          }
          return secret === acceptedBypassSecret
            ? new Response("<svg/>", {
                headers: {
                  "content-type": "image/svg+xml",
                  "set-cookie":
                    "_vercel_jwt=synthetic-bypass-cookie; Path=/; HttpOnly",
                },
              })
            : new Response("denied", { status: 401 });
        }
        default:
          return new Response("missing", { status: 404 });
      }
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

const openSession = (options: { readonly recordHar?: boolean } = {}) => {
  if (!browser) throw new Error("Chromium is not running");
  return E2EBrowserSession.open({
    browser,
    id: `session-test-${randomUUID()}`,
    ...options,
  });
};

const withSession = <A>(
  body: (session: E2EBrowserSession) => Effect.Effect<A, WorkspaceE2EError>,
  options: { readonly recordHar?: boolean } = {}
) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(options), body)));

const goto = (session: E2EBrowserSession, path: string) =>
  session.use(`open ${path}`, async (page) => {
    await page.goto(`${origin()}${path}`);
  });

const rawHarFiles = async (id: string) =>
  (await readdir(tmpdir())).filter(
    (name) => name.startsWith(`${id}-`) && name.endsWith(".har")
  );

test.skipIf(!chromiumAvailable)(
  "opens one context per session and closes it with the scope",
  async () => {
    if (!browser) throw new Error("Chromium is not running");
    const id = `session-lifecycle-${randomUUID()}`;
    const before = browser.contexts().length;
    const during = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* E2EBrowserSession.open({
            browser: browser as Browser,
            id,
          });
          yield* goto(session, "/");
          return { contexts: browser?.contexts().length };
        })
      )
    );

    expect(during.contexts).toBe(before + 1);
    expect(browser.contexts().length).toBe(before);
    // Playwright writes the raw HAR when the context closes; the scope then
    // deletes it.
    expect(await rawHarFiles(id)).toEqual([]);
  }
);

test.skipIf(!chromiumAvailable)(
  "closes the context before writing a sanitized HAR",
  async () => {
    const secret = "synthetic-har-query-secret";
    addRedaction(secret);
    const harPath = join(artifactDir, `${randomUUID()}.har`);
    const afterClose = await withSession((session) =>
      Effect.gen(function* () {
        yield* goto(session, `/?token=${secret}`);
        yield* session.close({ harPath });
        return yield* Effect.flip(
          session.use("read the title after close", (page) => page.title())
        );
      })
    );

    const har = await readFile(harPath, "utf8");
    const entries = (
      JSON.parse(har) as {
        log: { entries: { request: { url: string } }[] };
      }
    ).log.entries;
    expect(
      entries.some(({ request }) => request.url.startsWith(`${origin()}/?`))
    ).toBe(true);
    expect(har).not.toContain(secret);
    expect(afterClose.message).toBe(
      "read the title after close stopped because the browser session closed"
    );
  }
);

test.skipIf(!chromiumAvailable)(
  "captures failure artifacts from the active page, then exports the HAR",
  async () => {
    const secret = "synthetic-capture-query-secret";
    addRedaction(secret);
    const id = `session-capture-${randomUUID()}`;
    const directory = join(artifactDir, id);
    const afterCapture = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* E2EBrowserSession.open({
            browser: browser as Browser,
            id,
          });
          yield* session.use("open the noisy page", async (page) => {
            const failed = page.waitForEvent("pageerror");
            await page.goto(`${origin()}/noisy?count=2&echo=${secret}`);
            await failed;
          });
          yield* session.captureFailureArtifacts(directory);
          return yield* Effect.flip(
            session.use("read the title after capture", (page) => page.title())
          );
        })
      )
    );
    const read = (name: string) => readFile(join(directory, name), "utf8");

    expect((await readdir(directory)).sort()).toEqual([
      "console.txt",
      "errors.txt",
      "network-requests.txt",
      "network.har",
      "snapshot-interactive.txt",
    ]);
    expect(await read("console.txt")).toStartWith(
      "exitCode: 0\n\nstdout:\n[log] entry 0\n[log] entry 1\n"
    );
    expect(await read("errors.txt")).toContain("synthetic page failure");
    expect(await read("network-requests.txt")).toContain("/noisy?count=");
    expect(await read("snapshot-interactive.txt")).toContain("Noisy");
    const har = await read("network.har");
    expect(JSON.parse(har).log.entries.length).toBeGreaterThan(0);
    for (const name of await readdir(directory))
      expect(await read(name)).not.toContain(secret);
    expect(afterCapture.message).toBe(
      "read the title after capture stopped because the browser session closed"
    );
    expect(await rawHarFiles(id)).toEqual([]);
  }
);

test.skipIf(!chromiumAvailable)(
  "writes an unreadable snapshot empty and no HAR the session never recorded",
  async () => {
    const directory = join(artifactDir, `session-capture-${randomUUID()}`);
    const contextsBefore = browser?.contexts().length;
    await withSession(
      (session) =>
        Effect.gen(function* () {
          yield* goto(session, "/");
          yield* session.use("close the only page", (page) => page.close());
          yield* session.captureFailureArtifacts(directory);
          // The capture closed the context before the Scope did.
          expect(browser?.contexts().length).toBe(contextsBefore);
        }),
      { recordHar: false }
    );

    expect((await readdir(directory)).sort()).toEqual([
      "console.txt",
      "errors.txt",
      "network-requests.txt",
      "snapshot-interactive.txt",
    ]);
    expect(
      await readFile(join(directory, "snapshot-interactive.txt"), "utf8")
    ).toBe("\n");
  }
);

test.skipIf(!chromiumAvailable)(
  "writes no HAR when the session records none",
  async () => {
    const harPath = join(artifactDir, `${randomUUID()}.har`);
    await withSession(
      (session) =>
        Effect.gen(function* () {
          yield* goto(session, "/");
          yield* session.close({ harPath });
        }),
      { recordHar: false }
    );

    expect(await Bun.file(harPath).exists()).toBe(false);
  }
);

test.skipIf(!chromiumAvailable)(
  "removes the raw HAR when the export fails and settles every close once",
  async () => {
    if (!browser) throw new Error("Chromium is not running");
    const id = `session-export-${randomUUID()}`;
    const harPath = join(artifactDir, `${id}.har`);
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* E2EBrowserSession.open({
            browser: browser as Browser,
            id,
          });
          yield* goto(session, "/");
          const failedExport = yield* Effect.flip(
            session.close({ harPath: join(artifactDir, "missing", "x.har") })
          );
          const rawHars = yield* Effect.promise(() => rawHarFiles(id));
          const laterClose = yield* Effect.flip(session.close({ harPath }));
          return { failedExport, laterClose, rawHars };
        })
      )
    );

    expect(outcome.failedExport.message).toBe("write the browser HAR failed");
    expect(outcome.rawHars).toEqual([]);
    expect(outcome.laterClose.message).toBe("write the browser HAR failed");
    expect(await Bun.file(harPath).exists()).toBe(false);

    const shared = await withSession((session) =>
      Effect.gen(function* () {
        yield* goto(session, "/");
        yield* Effect.all([session.close({ harPath }), session.close()], {
          concurrency: "unbounded",
        });
        return yield* Effect.flip(
          session.close({ harPath: join(artifactDir, "other.har") })
        );
      })
    );
    expect(
      JSON.parse(await readFile(harPath, "utf8")).log.entries.length
    ).toBeGreaterThan(0);
    expect(shared.message).toBe(
      "The browser session already closed without this HAR"
    );
  }
);

test.skipIf(!chromiumAvailable)(
  "caps capture per kind and redacts it when read",
  async () => {
    const lateSecret = "synthetic-secret-registered-after-capture";
    const diagnostics = await withSession((session) =>
      Effect.gen(function* () {
        yield* session.use("load a noisy page", async (page) => {
          const failed = page.waitForEvent("pageerror");
          const echoed = page.waitForEvent("console", {
            predicate: (message) => message.text() === lateSecret,
          });
          await page.goto(`${origin()}/noisy?count=600&echo=${lateSecret}`);
          await Promise.all([failed, echoed]);
        });
        addRedaction(lateSecret);
        const captured = yield* session.diagnostics;
        yield* session.clearDiagnostics("console");
        return { captured, afterClear: yield* session.diagnostics };
      })
    );

    const { captured, afterClear } = diagnostics;
    expect(captured.console).toHaveLength(500);
    expect(captured.console.at(0)).toBe("[log] entry 101");
    expect(captured.console.at(-1)).toBe("[log] [redacted]");
    expect(captured.errors).toHaveLength(1);
    expect(captured.errors[0]).toContain("synthetic page failure");
    expect(captured.requests).toContain(
      `200 GET ${origin()}/noisy?count=600&echo=[redacted]`
    );
    expect(JSON.stringify(captured)).not.toContain(lateSecret);
    expect(afterClear.console).toEqual([]);
    expect(afterClear.errors).toEqual(captured.errors);
  }
);

test.skipIf(!chromiumAvailable)(
  "drives the page the app opens and falls back when it closes",
  async () => {
    const urls = await withSession((session) =>
      Effect.gen(function* () {
        yield* goto(session, "/");
        const opener = yield* session.use("open the popup", async (page) => {
          const [popup] = await Promise.all([
            page.waitForEvent("popup"),
            page.click("#popup"),
          ]);
          await popup.waitForLoadState();
          // Capture covers pages the app opens, not just the first one.
          await popup.evaluate(() => console.log("popup checked"));
          return page;
        });
        const popupUrl = yield* session.use("read the popup", async (page) =>
          page.url()
        );
        yield* session.activate(opener);
        const activatedUrl = yield* session.use(
          "read the opener",
          async (page) => page.url()
        );
        const popup = opener.context().pages()[1];
        if (!popup) throw new Error("popup missing");
        yield* session.activate(popup);
        yield* session.use("close the popup", (page) => page.close());
        const fallbackUrl = yield* session.use(
          "read the fallback",
          async (page) => page.url()
        );
        const closedActivation = yield* Effect.flip(session.activate(popup));
        const { console } = yield* session.diagnostics;
        return {
          activatedUrl,
          closedActivation: closedActivation.message,
          console,
          fallbackUrl,
          popupUrl,
        };
      })
    );

    expect(urls.popupUrl).toBe(`${origin()}/popup`);
    expect(urls.activatedUrl).toBe(`${origin()}/`);
    expect(urls.fallbackUrl).toBe(`${origin()}/`);
    expect(urls.closedActivation).toBe(
      "A closed browser page cannot become active"
    );
    expect(urls.console).toContain("[log] popup checked");
  }
);

// A Workspace deployment origin, the only kind that receives the secret; the
// session's `fetch` sends its probe to the local server instead.
const deploymentOrigin =
  "https://deskohub-workspace-abc123def-synthetic.vercel.app";

const toLocalServer = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin !== deploymentOrigin)
    throw new Error("The probe left the deployment origin");
  return fetch(new URL(`${url.pathname}${url.search}`, origin()), init);
}) as typeof fetch;

const withPreviewSession = <A>(
  body: (session: E2EBrowserSession) => Effect.Effect<A, WorkspaceE2EError>
) => {
  if (!browser) throw new Error("Chromium is not running");
  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(
        E2EBrowserSession.open({
          browser,
          fetch: toLocalServer,
          id: `preview-session-test-${randomUUID()}`,
          recordHar: false,
        }),
        body
      )
    )
  );
};

const holdProbe = () => {
  heldProbe = Promise.withResolvers<Response>();
  heldProbeArrived = Promise.withResolvers<void>();
  return {
    arrived: heldProbeArrived.promise,
    release: (response: Response) => {
      heldProbe?.resolve(response);
      heldProbe = undefined;
    },
  };
};

const acceptedProbe = () =>
  new Response(null, {
    headers: {
      location: "/favicon.svg",
      "set-cookie": "_vercel_jwt=synthetic-held-cookie; Path=/; HttpOnly",
    },
    status: 307,
  });

test.skipIf(!chromiumAvailable)(
  "primes a deployment origin once and fails closed on a rejected probe",
  async () => {
    bypassProbes.length = 0;
    const accepted = await withPreviewSession((session) =>
      Effect.gen(function* () {
        yield* session.primePreviewAccess(
          `${deploymentOrigin}/en-US/reservation`,
          acceptedBypassSecret,
          { timeoutMs: 5000 }
        );
        yield* session.primePreviewAccess(
          `${deploymentOrigin}/`,
          acceptedBypassSecret,
          { timeoutMs: 5000 }
        );
        return yield* session.use("read cookies", (page) =>
          page.context().cookies(deploymentOrigin)
        );
      })
    );
    expect(bypassProbes).toEqual([acceptedBypassSecret]);
    expect(accepted.map(({ httpOnly, name }) => ({ httpOnly, name }))).toEqual([
      { httpOnly: true, name: "_vercel_jwt" },
    ]);

    bypassProbes.length = 0;
    const rejected = await withPreviewSession((session) =>
      Effect.gen(function* () {
        const prime = session.primePreviewAccess(
          `${deploymentOrigin}/`,
          "synthetic-rejected-secret",
          { timeoutMs: 5000 }
        );
        const first = yield* Effect.flip(prime);
        yield* Effect.flip(prime);
        return first;
      })
    );
    expect(rejected.message).toBe(
      "The Vercel protection bypass probe failed with 401"
    );
    expect(isWorkspaceE2ETimeout(rejected)).toBe(false);
    expect(bypassProbes).toHaveLength(2);
  }
);

test.skipIf(!chromiumAvailable)(
  "counts an origin outside the deployments as primed without sending the secret",
  async () => {
    bypassProbes.length = 0;
    const cookies = await withSession((session) =>
      Effect.gen(function* () {
        yield* session.primePreviewAccess(
          `${origin()}/`,
          acceptedBypassSecret,
          { timeoutMs: 5000 }
        );
        yield* session.primePreviewAccess(`${origin()}/`, undefined, {
          timeoutMs: 5000,
        });
        yield* goto(session, "/");
        return yield* session.use("read cookies", (page) =>
          page.context().cookies()
        );
      })
    );
    expect(bypassProbes).toEqual([]);
    expect(cookies).toEqual([]);
  }
);

test.skipIf(!chromiumAvailable)(
  "shares one probe between concurrent primes and stops only an interrupted wait",
  async () => {
    bypassProbes.length = 0;
    const held = holdProbe();
    try {
      const outcome = await withPreviewSession((session) =>
        Effect.gen(function* () {
          const prime = session.primePreviewAccess(
            `${deploymentOrigin}/`,
            "synthetic-held-secret",
            { timeoutMs: 10_000 }
          );
          const interrupted = yield* Effect.forkChild(prime, {
            startImmediately: true,
          });
          const waiting = yield* Effect.forkChild(prime, {
            startImmediately: true,
          });
          yield* Effect.promise(() => held.arrived);
          const interruptedAt = Date.now();
          yield* Fiber.interrupt(interrupted);
          const interruptMs = Date.now() - interruptedAt;
          held.release(acceptedProbe());
          yield* Fiber.join(waiting);
          const cookies = yield* session.use("read cookies", (page) =>
            page.context().cookies(deploymentOrigin)
          );
          return { cookies, interruptMs };
        })
      );
      expect(outcome.interruptMs).toBeLessThan(1000);
      expect(outcome.cookies.map(({ name }) => name)).toEqual(["_vercel_jwt"]);
      expect(bypassProbes).toEqual(["synthetic-held-secret"]);
    } finally {
      held.release(new Response("late", { status: 401 }));
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "classifies a probe that outlives its timeout as a timeout",
  async () => {
    const held = holdProbe();
    try {
      const failure = await withPreviewSession((session) =>
        Effect.flip(
          session.primePreviewAccess(
            `${deploymentOrigin}/`,
            "synthetic-held-secret",
            { timeoutMs: 200 }
          )
        )
      );
      expect(isWorkspaceE2ETimeout(failure)).toBe(true);
      expect(failure.message).toBe(
        "The Vercel protection bypass request timed out"
      );
    } finally {
      held.release(new Response("late", { status: 401 }));
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "aborts a held probe when the session closes and fails its waiters as cut off",
  async () => {
    const held = holdProbe();
    heldProbeAborted = false;
    try {
      const failure = await withPreviewSession((session) =>
        Effect.gen(function* () {
          const waiting = yield* Effect.forkChild(
            Effect.flip(
              session.primePreviewAccess(
                `${deploymentOrigin}/`,
                "synthetic-held-secret",
                { timeoutMs: 10_000 }
              )
            ),
            { startImmediately: true }
          );
          yield* Effect.promise(() => held.arrived);
          yield* session.close();
          const failure = yield* Fiber.join(waiting);
          const afterClose = yield* Effect.flip(
            session.primePreviewAccess(
              `${deploymentOrigin}/`,
              acceptedBypassSecret,
              { timeoutMs: 5000 }
            )
          );
          return { afterClose, failure };
        })
      );
      expect(failure.failure.message).toBe(
        "prime preview access stopped because the browser session closed"
      );
      expect(failure.afterClose.message).toBe(
        "prime preview access stopped because the browser session closed"
      );
      await Bun.sleep(50);
      expect(heldProbeAborted).toBe(true);
    } finally {
      held.release(new Response("late", { status: 401 }));
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "closes a context created while its opener was interrupted",
  async () => {
    if (!browser) throw new Error("Chromium is not running");
    const before = browser.contexts().length;
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const opening = yield* Effect.forkChild(
            Effect.scoped(openSession()),
            { startImmediately: true }
          );
          yield* Fiber.interrupt(opening);
        })
      )
    );
    // The browser answers context requests in order, so once this probe
    // context exists, a context the session requested earlier exists too.
    const probe = await browser.newContext();
    await probe.close();

    expect(browser.contexts().length).toBe(before);
  }
);

/**
 * A browser whose contexts hold `close()` until the test lets go, optionally
 * failing to open their first page.
 */
const stallingContextClose = (options: { readonly failNewPage: boolean }) => {
  if (!browser) throw new Error("Chromium is not running");
  const realBrowser = browser;
  const closeRequested = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  const contexts: BrowserContext[] = [];
  const stalling = {
    newContext: async (
      contextOptions?: Parameters<Browser["newContext"]>[0]
    ) => {
      const context = await realBrowser.newContext(contextOptions);
      contexts.push(context);
      context.close = () => {
        closeRequested.resolve();
        return held.promise;
      };
      if (options.failNewPage)
        context.newPage = () =>
          Promise.reject(new Error("synthetic page failure"));
      return context;
    },
  } as unknown as Browser;
  return {
    browser: stalling,
    closeRequested: closeRequested.promise,
    release: async () => {
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
    },
  };
};

/**
 * Closes the session's Scope while `context.close()` stalls, moves the clock
 * to just short of one browser action and then past it, and reports whether
 * the Scope was still waiting before the bound and settled after it. When the
 * session opened, it lets the close go and reports the raw HAR files left.
 */
const settleScopeOverStalledClose = async (options: {
  readonly failNewPage: boolean;
}) => {
  const stalling = stallingContextClose(options);
  const id = `session-stalled-close-${randomUUID()}`;
  let opened: E2EBrowserSession | undefined;
  const observed = await Effect.runPromise(
    Effect.gen(function* () {
      // Detached, so a Scope stuck in its finalizers cannot hold the test.
      const scoped = yield* Effect.forkDetach(
        Effect.scoped(
          Effect.flatMap(
            E2EBrowserSession.open({ browser: stalling.browser, id }),
            (session) => {
              opened = session;
              return goto(session, "/");
            }
          )
        )
      );
      yield* Effect.promise(() => stalling.closeRequested);
      yield* TestClock.adjust(
        `${workspaceE2ETimeouts.browserAction - 1000} millis`
      );
      // Real time, which the TestClock does not control, lets anything the
      // clock released run before the fiber is inspected.
      yield* Effect.promise(() => Bun.sleep(100));
      const waitingBeforeBound = scoped.pollUnsafe() === undefined;
      yield* TestClock.adjust("2 seconds");
      const settled = yield* Effect.raceFirst(
        Fiber.await(scoped),
        Effect.promise(() => Bun.sleep(2000)).pipe(Effect.as("stalled"))
      );
      return {
        settled: settled === "stalled" ? settled : settled._tag,
        waitingBeforeBound,
      };
    }).pipe(Effect.provide(TestClock.layer()))
  ).finally(stalling.release);
  if (!opened) return observed;
  // The detached close finishes once the context really closes; a later
  // close shares its outcome, raw HAR removal included.
  await Effect.runPromise(Effect.ignore(opened.close()));
  return { ...observed, rawHars: await rawHarFiles(id) };
};

test.skipIf(!chromiumAvailable)(
  "waits for a stalled context close at most one browser action",
  async () => {
    expect(await settleScopeOverStalledClose({ failNewPage: false })).toEqual({
      rawHars: [],
      settled: "Success",
      waitingBeforeBound: true,
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "bounds the close of a context whose first page failed to open",
  async () => {
    expect(await settleScopeOverStalledClose({ failNewPage: true })).toEqual({
      settled: "Failure",
      waitingBeforeBound: true,
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "classifies Playwright and session timeouts as timeouts",
  async () => {
    const failures = await withSession((session) =>
      Effect.gen(function* () {
        yield* goto(session, "/");
        return yield* Effect.all([
          Effect.flip(
            session.use("wait for a missing element", (page) =>
              page.locator("#missing").waitFor({ timeout: 50 })
            )
          ),
          Effect.flip(
            session.use("wait forever", () => new Promise<never>(() => {}), {
              timeoutMs: 50,
            })
          ),
          Effect.flip(
            session.evaluate(
              "evaluate forever",
              () => new Promise<never>(() => {}),
              undefined,
              { timeoutMs: 50 }
            )
          ),
        ]);
      })
    );

    for (const failure of failures) {
      expect(failure.reason).toBe("timeout");
      expect(isWorkspaceE2ETimeout(failure)).toBe(true);
    }
    expect(failures.map(({ message }) => message)).toEqual([
      "wait for a missing element timed out",
      "Timed out running wait forever after 50ms",
      "Timed out running evaluate forever after 50ms",
    ]);
  }
);

test.skipIf(!chromiumAvailable)(
  "reports failures without the raw browser cause",
  async () => {
    const callerError = workspaceE2EError("caller failure");
    const failures = await withSession((session) =>
      Effect.all([
        Effect.flip(
          session.use("navigate privately", async () => {
            throw new Error(
              `net::ERR_FAILED at ${origin()}/private pin=4821 cookie=ab12`
            );
          })
        ),
        Effect.flip(
          session.use("assert the total", async () => {
            ok(false, "total differs");
          })
        ),
        Effect.flip(
          session.use("pass a caller failure", async () => {
            throw callerError;
          })
        ),
      ])
    );

    const [browserFailure, assertion, caller] = failures;
    expect(browserFailure.message).toBe("navigate privately failed");
    expect(browserFailure.cause).toBeUndefined();
    expect(browserFailure.reason).toBeUndefined();
    expect(assertion.message).toBe("assert the total failed: total differs");
    expect(assertion.cause).toBeUndefined();
    expect(caller).toBe(callerError);
  }
);

test.skipIf(!chromiumAvailable)(
  "keeps the session cookie, bypass, and PIN out of every rendering of a failure",
  async () => {
    const sessionCookie = "seeded-session-token.signed-session-value";
    const bypassSecret = "raw-vercel-bypass-secret";
    const fixturePin = "1111111";
    const failure = await withSession((session) =>
      Effect.flip(
        session.use("probe the protected admin page", async () => {
          throw new Error(
            `request failed with headers {"cookie":"__Secure-better-auth.session_token=${sessionCookie}; _vercel_protection_bypass=${bypassSecret}",` +
              `"x-vercel-protection-bypass":"${bypassSecret}"} body pin=${fixturePin}`
          );
        })
      )
    );

    expect(failure.operation).toBe("probe the protected admin page");
    expect(failure.message).toBe("probe the protected admin page failed");
    for (const secret of [sessionCookie, bypassSecret, fixturePin]) {
      expect(formatWorkspaceE2EFailure(failure)).not.toContain(secret);
      expect(JSON.stringify(failure)).not.toContain(secret);
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "stops waiting when interrupted and reports work cut off by close",
  async () => {
    const outcome = await withSession((session) =>
      Effect.gen(function* () {
        yield* goto(session, "/");
        const hangingStarted = Promise.withResolvers<void>();
        const hanging = yield* Effect.forkChild(
          session.use("wait for nothing", () => {
            hangingStarted.resolve();
            return new Promise<never>(() => {});
          })
        );
        yield* Effect.promise(() => hangingStarted.promise);
        const interruptedAt = Date.now();
        yield* Fiber.interrupt(hanging);
        const interruptMs = Date.now() - interruptedAt;
        const stillUsable = yield* session.evaluate(
          "evaluate after interrupt",
          (value: number) => value + 1,
          1,
          { timeoutMs: 5000 }
        );

        const started = Promise.withResolvers<void>();
        const waiting = yield* Effect.forkChild(
          session.use("wait for a late element", (page) => {
            started.resolve();
            return page.locator("#late").waitFor({ timeout: 10_000 });
          })
        );
        yield* Effect.promise(() => started.promise);
        yield* session.close();
        const cutOff = yield* Effect.flip(Fiber.join(waiting));
        return { cutOff: cutOff.message, interruptMs, stillUsable };
      })
    );

    expect(outcome.interruptMs).toBeLessThan(1000);
    expect(outcome.stillUsable).toBe(2);
    expect(outcome.cutOff).toBe(
      "wait for a late element stopped because the browser session closed"
    );
  }
);

test.skipIf(!chromiumAvailable)(
  "evaluates a self-contained function with its argument",
  async () => {
    const total = await withSession((session) =>
      Effect.gen(function* () {
        yield* goto(session, "/");
        return yield* session.evaluate(
          "add to the title length",
          ({ left, right }: { left: number; right: number }) =>
            left + right + document.title.length,
          { left: 1, right: 2 },
          { timeoutMs: 5000 }
        );
      })
    );

    expect(total).toBe(1 + 2 + "Session".length);
  }
);

test.skipIf(!chromiumAvailable)(
  "describes a cookie by its attributes and expected value, never the value",
  async () => {
    const siteUrl = "https://workspace.example.test";
    const value = "synthetic-remembered-code";
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* openSession();
          yield* session.use("add cookies", (page) =>
            page.context().addCookies([
              {
                expires: Math.round(Date.now() / 1000) + 30 * 86_400,
                httpOnly: false,
                name: "remembered",
                sameSite: "Lax",
                secure: true,
                url: siteUrl,
                value,
              },
            ])
          );
          yield* session.setSessionCookie({
            name: "session_token",
            url: siteUrl,
            value: "synthetic-session",
          });
          const described = yield* Effect.all({
            absent: session.describeCookie({ name: "absent", url: siteUrl }),
            differs: session.describeCookie({
              name: "remembered",
              url: `${siteUrl}/en-US/account`,
              value: "another-code",
            }),
            matches: session.describeCookie({
              name: "remembered",
              url: siteUrl,
              value,
            }),
            sessionCookie: session.describeCookie({
              name: "session_token",
              url: siteUrl,
            }),
          });
          const invalidQuery = yield* Effect.flip(
            session.describeCookie({ name: "remembered", url: "not a url" })
          );
          yield* session.close();
          const afterClose = yield* Effect.flip(
            session.describeCookie({ name: "remembered", url: siteUrl })
          );
          return { afterClose, described, invalidQuery };
        })
      )
    );

    expect(outcome.described).toEqual({
      absent: { present: false },
      differs: {
        httpOnly: false,
        lifetimeDays: 30,
        matches: false,
        path: "/",
        present: true,
        sameSite: "Lax",
        secure: true,
      },
      matches: {
        httpOnly: false,
        lifetimeDays: 30,
        matches: true,
        path: "/",
        present: true,
        sameSite: "Lax",
        secure: true,
      },
      sessionCookie: {
        httpOnly: true,
        lifetimeDays: null,
        matches: null,
        path: "/",
        present: true,
        sameSite: "Lax",
        secure: true,
      },
    });
    for (const failure of [outcome.invalidQuery, outcome.afterClose]) {
      expect(failure.operation).toBe("read browser cookie");
      expect(isWorkspaceE2ETimeout(failure)).toBe(false);
    }
    expect(outcome.afterClose.message).toContain("browser session closed");
    expect(
      JSON.stringify([
        outcome.described,
        outcome.invalidQuery,
        outcome.afterClose,
      ])
    ).not.toContain(value);
  }
);

test.skipIf(!chromiumAvailable)(
  "sets only HTTP-only session cookies bound to an HTTPS origin",
  async () => {
    const siteUrl = "https://workspace.example.test";
    const outcome = await withSession((session) =>
      Effect.gen(function* () {
        yield* session.setSessionCookie({
          name: "session_token",
          url: siteUrl,
          value: "synthetic-session",
        });
        const rejected = yield* Effect.all(
          [
            {
              name: "session_token",
              url: "http://workspace.example.test",
              value: "x",
            },
            { name: "session_token", url: `${siteUrl}/en-US`, value: "x" },
            { name: "session_token", url: siteUrl, value: "" },
          ].map((cookie) => Effect.flip(session.setSessionCookie(cookie)))
        );
        const cookies = yield* session.use("read cookies", (page) =>
          page.context().cookies(siteUrl)
        );
        return { cookies, rejected };
      })
    );

    expect(outcome.rejected).toHaveLength(3);
    expect(outcome.cookies).toEqual([
      expect.objectContaining({
        domain: "workspace.example.test",
        httpOnly: true,
        name: "session_token",
        path: "/",
        sameSite: "Lax",
        secure: true,
        value: "synthetic-session",
      }),
    ]);
  }
);
