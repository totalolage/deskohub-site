import { afterAll, beforeAll, expect, test } from "bun:test";
import { ok } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium } from "@playwright/test";
import { Effect, Fiber } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { E2EBrowserSession } from "./browser-session";
import {
  isWorkspaceE2ETimeout,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "./errors";
import { addRedaction } from "./redaction";

// The session owns what Playwright does not, so these run against a real
// Chromium and a local server instead of a scripted adapter.
const chromiumAvailable = await playwrightChromiumAvailable();
const acceptedBypassSecret = "synthetic-accepted-bypass-secret";
let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let artifactDir = "";
const bypassProbes: (string | null)[] = [];
const bypassHeaders = (secret: string) => ({
  "x-vercel-protection-bypass": secret,
  "x-vercel-set-bypass-cookie": "true",
});
let heldProbe: PromiseWithResolvers<Response> | undefined;
let heldProbeArrived: PromiseWithResolvers<void> | undefined;

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
            `<body><script>
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

test.skipIf(!chromiumAvailable)(
  "primes preview access once per origin and fails closed",
  async () => {
    bypassProbes.length = 0;
    const accepted = await withSession((session) =>
      Effect.gen(function* () {
        yield* session.primePreviewAccess(
          `${origin()}/en-US/reservation`,
          bypassHeaders(acceptedBypassSecret),
          { timeoutMs: 5000 }
        );
        yield* session.primePreviewAccess(
          `${origin()}/`,
          bypassHeaders(acceptedBypassSecret),
          {
            timeoutMs: 5000,
          }
        );
        return yield* session.use("read cookies", (page) =>
          page.context().cookies(origin())
        );
      })
    );
    expect(bypassProbes).toEqual([acceptedBypassSecret]);
    expect(accepted.map(({ name }) => name)).toEqual(["_vercel_jwt"]);

    bypassProbes.length = 0;
    const rejected = await withSession((session) =>
      Effect.gen(function* () {
        const prime = session.primePreviewAccess(
          `${origin()}/`,
          bypassHeaders("synthetic-rejected-secret"),
          { timeoutMs: 5000 }
        );
        const first = yield* Effect.flip(prime);
        yield* Effect.flip(prime);
        return first;
      })
    );
    expect(rejected.message).toBe("Preview bypass probe failed with 401");
    expect(bypassProbes).toHaveLength(2);
  }
);

test.skipIf(!chromiumAvailable)(
  "stops waiting for a held bypass probe when interrupted",
  async () => {
    heldProbe = Promise.withResolvers<Response>();
    heldProbeArrived = Promise.withResolvers<void>();
    try {
      const interruptMs = await withSession((session) =>
        Effect.gen(function* () {
          const probing = yield* Effect.forkChild(
            session.primePreviewAccess(
              `${origin()}/`,
              bypassHeaders("synthetic-held-secret"),
              {
                timeoutMs: 10_000,
              }
            )
          );
          yield* Effect.promise(
            () => heldProbeArrived?.promise ?? Promise.resolve()
          );
          const interruptedAt = Date.now();
          yield* Fiber.interrupt(probing);
          return Date.now() - interruptedAt;
        })
      );
      expect(interruptMs).toBeLessThan(1000);
    } finally {
      heldProbe.resolve(new Response("late", { status: 401 }));
      heldProbe = undefined;
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
