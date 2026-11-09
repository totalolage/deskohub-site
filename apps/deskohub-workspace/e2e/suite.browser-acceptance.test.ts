import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "@playwright/test";
import { Cause, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { sanitizeHarArtifact } from "./artifact-sanitization";
import { openPage } from "./browser";
import type { OpenE2EBrowserSession } from "./browser-session";
import type { DatasourceConfig } from "./config";
import { WorkspaceE2EHostedPaymentPermitServiceMock } from "./coordination/hosted-payment-permit.service.mock";
import { WorkspaceE2EProviderVerificationPermitServiceMock } from "./coordination/provider-verification-permit.service.mock";
import { runUntracedE2EEffect } from "./effect-edge";
import { workspaceE2EError } from "./errors";
import { E2EDatabase } from "./integrations/database.service";
import { addRedaction } from "./redaction";
import { WorkspaceE2ECleanupService } from "./services/cleanup";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "./services/telemetry.mock";
import { runWorkspaceE2ECase } from "./suite";
import { type WorkspaceE2ETimeouts, workspaceE2ETimeouts } from "./timeouts";
import type { WorkspaceE2ECase } from "./types";

// A checkout case's browser lifecycle on a real Chromium, through the C03
// case runner, with the case's sessions owned by a test Scope as the checkout
// fixture owns them.
const chromiumAvailable = await playwrightChromiumAvailable();
const pageSecret = "synthetic-suite-page-secret";
const sessionPrefix = "suite-test";
// Above the cases' 25 s bound plus one browser-action session release.
const caseTestTimeoutMs = 60_000;
let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let artifactRoot = "";

/** Pages blocked on `/held?id=…`, which answers once the test releases it. */
const pageHolds = new Map<
  string,
  {
    readonly blocked: PromiseWithResolvers<void>;
    readonly released: PromiseWithResolvers<void>;
  }
>();

/**
 * A page path whose main thread blocks once loaded. `blocked` settles when
 * the page is stuck, `release` lets it go.
 */
const holdPage = () => {
  const id = randomUUID();
  const hold = {
    blocked: Promise.withResolvers<void>(),
    released: Promise.withResolvers<void>(),
  };
  pageHolds.set(id, hold);
  return {
    blocked: hold.blocked.promise,
    path: `/busy?id=${id}`,
    release: () => hold.released.resolve(),
  };
};

beforeAll(async () => {
  if (!chromiumAvailable) return;
  addRedaction(pageSecret);
  artifactRoot = await mkdtemp(join(tmpdir(), "suite-test-"));
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    fetch: async (request, httpServer) => {
      const { pathname, searchParams } = new URL(request.url);
      if (pathname === "/api")
        return Response.json({ echoed: request.headers.get("authorization") });
      if (pathname === "/held") {
        const hold = pageHolds.get(searchParams.get("id") ?? "");
        if (!hold) return new Response("unknown hold", { status: 404 });
        // Bun ends an idle request after 10 s, which would let the page go.
        httpServer.timeout(request, 0);
        hold.blocked.resolve();
        await hold.released.promise;
        return new Response("released");
      }
      // After load, which the open waits for, a synchronous request holds
      // the page's main thread, so a script evaluated in the page, as the
      // artifact capture's reads are, can't run until the test answers it.
      const script =
        pathname === "/busy"
          ? `addEventListener("load", () => setTimeout(() => {
               const request = new XMLHttpRequest();
               request.open("GET", "/held" + location.search, false);
               request.send();
             }));`
          : `console.log(location.search);
             fetch("/api?token=${pageSecret}", { headers: { authorization: "${pageSecret}" } });`;
      return new Response(
        `<!doctype html><html lang="en"><head><title>Synthetic checkout</title></head>
        <body><h1>Synthetic checkout</h1><script>${script}</script></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    },
  });
});

afterAll(async () => {
  for (const hold of pageHolds.values()) hold.released.resolve();
  await browser?.close();
  await server?.stop(true);
  if (artifactRoot) await rm(artifactRoot, { force: true, recursive: true });
});

const origin = () => {
  if (!server) throw new Error("test server is not running");
  return `http://localhost:${server.port}`;
};

const realBrowser = () => {
  if (!browser) throw new Error("Chromium is not running");
  return browser;
};

const testTimeouts = (
  overrides: Partial<WorkspaceE2ETimeouts> = {}
): WorkspaceE2ETimeouts => ({
  ...workspaceE2ETimeouts,
  artifactCapture: 5000,
  browserAction: 5000,
  cleanupAction: 5000,
  ...overrides,
});

const testDatasourceConfig = {} as DatasourceConfig;

// Cases here own no checkout states, so cleanup never queries the database.
const unusedDatabase = Layer.succeed(E2EDatabase, {} as E2EDatabase["Service"]);

const suiteLayer = (
  observations: E2ETelemetryObservation[],
  cleanup: Layer.Layer<WorkspaceE2ECleanupService> = WorkspaceE2ECleanupService.Default
) =>
  Layer.mergeAll(
    makeE2ETelemetryMock(observations),
    cleanup,
    unusedDatabase,
    WorkspaceE2EHostedPaymentPermitServiceMock,
    WorkspaceE2EProviderVerificationPermitServiceMock
  );

/** One case as the checkout fixture runs it: its sessions in a test Scope. */
const runCase = async (input: {
  readonly browser?: Browser;
  readonly cleanup?: Layer.Layer<WorkspaceE2ECleanupService>;
  readonly execute: WorkspaceE2ECase["execute"];
  readonly id?: string;
  readonly timeouts?: WorkspaceE2ETimeouts;
}) => {
  const id = input.id ?? `case-${randomUUID()}`;
  const scope = Scope.makeUnsafe("parallel");
  const observations: E2ETelemetryObservation[] = [];
  const exit = await Effect.runPromiseExit(
    runWorkspaceE2ECase({
      artifactRoot,
      browser: input.browser ?? realBrowser(),
      datasourceConfig: testDatasourceConfig,
      sessionPrefix,
      testCase: {
        checkoutStates: [],
        execute: input.execute,
        id,
        timeoutMs: 20_000,
      },
      timeouts: input.timeouts ?? testTimeouts(),
    }).pipe(
      Scope.provide(scope),
      Effect.provide(suiteLayer(observations, input.cleanup)),
      // Bun's runner gives the whole case a real-time bound of its own.
      Effect.timeout("25 seconds")
    )
  );
  return {
    artifactDir: join(artifactRoot, id),
    closeScope: () => runUntracedE2EEffect(Scope.close(scope, Exit.void)),
    exit,
    id,
    observations,
  };
};

const annotation = (observations: readonly E2ETelemetryObservation[]) =>
  observations.filter((observation) => observation.scope === "annotation");

const artifactFiles = async (directory: string) => {
  try {
    return (await readdir(directory)).sort();
  } catch {
    return [];
  }
};

const rawHarFiles = async (id: string) =>
  (await readdir(tmpdir())).filter(
    (name) => name.startsWith(`${id}-`) && name.endsWith(".har")
  );

/** Opens `url` in the case's session, as the case modules navigate. */
const openCasePage = (openSession: OpenE2EBrowserSession, url: string) =>
  Effect.flatMap(openSession, (session) =>
    openPage(session, { bypassSecret: undefined }, url, { timeoutMs: 10_000 })
  );

/** The case's own browser context. */
const caseContext = (openSession: OpenE2EBrowserSession) =>
  Effect.flatMap(openSession, (session) =>
    session.use("read the context", async (page) => page.context())
  );

/** A browser whose contexts hold `close()` until the test lets go. */
const stallingContextClose = () => {
  const real = realBrowser();
  const held = Promise.withResolvers<void>();
  const contexts: BrowserContext[] = [];
  let closes = 0;
  return {
    browser: {
      newContext: async (options?: Parameters<Browser["newContext"]>[0]) => {
        const context = await real.newContext(options);
        contexts.push(context);
        context.close = () => {
          closes += 1;
          return held.promise;
        };
        return context;
      },
    } as unknown as Browser,
    /** Context closes called so far, each held until `release`. */
    closes: () => closes,
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

/** A real browser whose contexts run `beforeClose` as they start closing. */
const browserClosingWith = (beforeClose: () => void) => {
  const real = realBrowser();
  return {
    newContext: async (options?: Parameters<Browser["newContext"]>[0]) => {
      const context = await real.newContext(options);
      const close = context.close.bind(context);
      context.close = (closeOptions) => {
        beforeClose();
        return close(closeOptions);
      };
      return context;
    },
  } as unknown as Browser;
};

/**
 * A real browser that lists the raw HARs named after `sessionId` as each of
 * its contexts finishes closing, before the session removes them.
 */
const browserListingRawHarsOnClose = (
  sessionId: string,
  listed: Set<string>
) => {
  const real = realBrowser();
  const newContext: Browser["newContext"] = async (options) => {
    const context = await real.newContext(options);
    const close = context.close.bind(context);
    context.close = async (closeOptions) => {
      await close(closeOptions);
      for (const name of await rawHarFiles(sessionId)) listed.add(name);
    };
    return context;
  };
  return new Proxy(real, {
    get: (target, property) => {
      if (property === "newContext") return newContext;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
};

test.skipIf(!chromiumAvailable)(
  "passes a case in its own session and closes it during finalization",
  async () => {
    const id = `case-${randomUUID()}`;
    const sessionId = `${sessionPrefix}-${id}`;
    const rawHarsAtClose = new Set<string>();
    let context: BrowserContext | undefined;
    let sharedSession = false;
    const result = await runCase({
      browser: browserListingRawHarsOnClose(sessionId, rawHarsAtClose),
      execute: ({ openSession, runStep }) =>
        runStep({
          execute: Effect.gen(function* () {
            yield* openCasePage(openSession, `${origin()}/`);
            context = yield* caseContext(openSession);
            const session = yield* openSession;
            sharedSession = (yield* openSession) === session;
          }),
          id: "open-checkout",
          timeoutMs: 10_000,
        }),
      id,
    });
    const closedBeforeScope = !realBrowser()
      .contexts()
      .includes(context as BrowserContext);
    await result.closeScope();

    expect(Exit.isSuccess(result.exit)).toBe(true);
    // Every use of the case's session shares the one session the suite
    // opened, recording its HAR under the case's session id.
    expect(sharedSession).toBe(true);
    expect(rawHarsAtClose.size).toBe(1);
    expect(closedBeforeScope).toBe(true);
    expect(annotation(result.observations)).toEqual([]);
    expect(result.observations).toContainEqual(
      expect.objectContaining({ outcome: "passed", scope: "case" })
    );
    expect(await artifactFiles(result.artifactDir)).toEqual([]);
    expect(await rawHarFiles(sessionId)).toEqual([]);
  },
  caseTestTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "captures failure artifacts from the open page, then exports the HAR",
  async () => {
    const id = `case-${randomUUID()}`;
    let snapshotBeforeClose = false;
    const result = await runCase({
      id,
      execute: ({ openSession, runStep }) =>
        runStep({
          execute: Effect.gen(function* () {
            const context = yield* caseContext(openSession);
            const [page] = context.pages();
            if (!page) return yield* workspaceE2EError("no checkout page");
            // Listening before the navigation, which starts the request.
            const answered = page.waitForResponse((response) =>
              response.url().includes("/api")
            );
            yield* openCasePage(
              openSession,
              `${origin()}/?token=${pageSecret}`
            );
            yield* Effect.promise(() => answered);
            context.once("close", () => {
              snapshotBeforeClose = existsSync(
                join(artifactRoot, id, "snapshot-interactive.txt")
              );
            });
            return yield* workspaceE2EError("synthetic checkout failure");
          }),
          id: "submit-checkout",
          timeoutMs: 10_000,
        }),
    });
    await result.closeScope();

    expect(Exit.isFailure(result.exit)).toBe(true);
    expect(annotation(result.observations)).toEqual([
      {
        caseId: result.id,
        failureKind: "error",
        outcome: "failed",
        scope: "annotation",
        stepId: "submit-checkout",
      },
    ]);
    expect(snapshotBeforeClose).toBe(true);
    expect(await artifactFiles(result.artifactDir)).toEqual([
      "browser-diagnostics.txt",
      "console.txt",
      "error.txt",
      "errors.txt",
      "network-requests.txt",
      "network.har",
      "snapshot-interactive.txt",
    ]);
    const read = (name: string) =>
      readFile(join(result.artifactDir, name), "utf8");
    expect(await read("error.txt")).toContain("synthetic checkout failure");
    expect(await read("browser-diagnostics.txt")).toStartWith(
      'Browser diagnostics:\n{"alerts":[]'
    );
    expect(await read("console.txt")).toStartWith("exitCode: 0\n\nstdout:\n");
    expect(await read("errors.txt")).toBe("exitCode: 0\n");
    expect(await read("network-requests.txt")).toContain("/api?token=");
    expect(await read("snapshot-interactive.txt")).toContain(
      "Synthetic checkout"
    );
    const har = await read("network.har");
    expect(
      JSON.parse(har).log.entries.some((entry: { request: { url: string } }) =>
        entry.request.url.includes("/api")
      )
    ).toBe(true);
    expect(har).toEndWith("}\n");
    for (const name of await artifactFiles(result.artifactDir))
      expect(await read(name)).not.toContain(pageSecret);
    expect(await rawHarFiles(`${sessionPrefix}-${result.id}`)).toEqual([]);
  },
  caseTestTimeoutMs
);

/** Settles once the page's `/api` response body has fully arrived. */
const apiRequestFinished = (page: Page) =>
  page.waitForEvent("requestfinished", (request) =>
    request.url().includes("/api")
  );

/**
 * The HAR a failure capture exports for the same page, recorded directly: the
 * session's recording options, sanitized by the session's close and again by
 * the capture.
 */
const recordCaptureHar = async (url: string) => {
  const path = join(artifactRoot, `reference-${randomUUID()}.har`);
  const context = await realBrowser().newContext({
    recordHar: { content: "embed", mode: "full", path },
  });
  try {
    const page = await context.newPage();
    const finished = apiRequestFinished(page);
    await page.goto(url);
    await finished;
  } finally {
    await context.close();
  }
  const har = await readFile(path, "utf8");
  await rm(path, { force: true });
  return sanitizeHarArtifact(sanitizeHarArtifact(har));
};

type HarEntry = {
  readonly request: { readonly url: string };
  readonly response: {
    readonly content: {
      readonly mimeType?: string;
      readonly size?: number;
      readonly text?: string;
    };
    readonly status: number;
  };
};

/** The page's own exchanges, without timings and page ids. */
const harExchanges = (har: string, pageOrigin: string) =>
  (JSON.parse(har) as { log: { entries: HarEntry[] } }).log.entries
    .filter(({ request }) => request.url.startsWith(pageOrigin))
    .map(({ request, response }) => ({ request, response }))
    .sort((left, right) => left.request.url.localeCompare(right.request.url));

test.skipIf(!chromiumAvailable)(
  "exports the settled responses a direct HAR recording of the page holds",
  async () => {
    const result = await runCase({
      execute: ({ openSession, runStep }) =>
        runStep({
          execute: Effect.gen(function* () {
            const context = yield* caseContext(openSession);
            const [page] = context.pages();
            if (!page) return yield* workspaceE2EError("no checkout page");
            // Listening before the navigation, which starts the request.
            const finished = apiRequestFinished(page);
            yield* openCasePage(openSession, `${origin()}/`);
            yield* Effect.promise(() => finished);
            return yield* workspaceE2EError("synthetic checkout failure");
          }),
          id: "submit-checkout",
          timeoutMs: 10_000,
        }),
    });
    await result.closeScope();
    const har = await readFile(join(result.artifactDir, "network.har"), "utf8");
    const reference = await recordCaptureHar(`${origin()}/`);

    expect(Exit.isFailure(result.exit)).toBe(true);
    const exchanges = harExchanges(har, origin());
    expect(exchanges).toEqual(harExchanges(reference, origin()));
    expect(
      exchanges.map(({ request }) => new URL(request.url).pathname)
    ).toEqual(["/", "/api"]);
    // The JSON response keeps its body, sanitized, not just its headers.
    const api = exchanges.find(({ request }) => request.url.includes("/api"));
    expect(api?.response.status).toBe(200);
    expect(api?.response.content.mimeType).toContain("application/json");
    expect(api?.response.content.size).toBeGreaterThan(0);
    expect(api?.response.content.text).toBeString();
    expect(api?.response.content.text).not.toBe("");
    expect(har).not.toContain(pageSecret);
  },
  caseTestTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "annotates a step timeout with its step and a typed failure with its code",
  async () => {
    const timedOut = await runCase({
      execute: ({ openSession, runStep }) =>
        runStep({
          execute: openCasePage(openSession, `${origin()}/`).pipe(
            Effect.andThen(Effect.never)
          ),
          id: "wait-for-checkout",
          timeoutMs: 1000,
        }),
    });
    await timedOut.closeScope();
    const coded = await runCase({
      execute: ({ openSession, runStep }) =>
        runStep({
          execute: openCasePage(openSession, `${origin()}/`).pipe(
            Effect.andThen(
              workspaceE2EError("synthetic provider session failure", {
                diagnosticCode:
                  "provider_session_row_read_failed_after_redirect",
              })
            )
          ),
          id: "read-provider-session",
          timeoutMs: 10_000,
        }),
    });
    await coded.closeScope();

    expect(annotation(timedOut.observations)).toEqual([
      {
        caseId: timedOut.id,
        failureKind: "timeout",
        outcome: "timed_out",
        scope: "annotation",
        stepId: "wait-for-checkout",
      },
    ]);
    expect(annotation(coded.observations)).toEqual([
      {
        caseId: coded.id,
        diagnosticCode: "provider_session_row_read_failed_after_redirect",
        failureKind: "error",
        outcome: "failed",
        scope: "annotation",
        stepId: "read-provider-session",
      },
    ]);
  },
  caseTestTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "captures a browser that opens only after diagnostics start timed out",
  async () => {
    const real = realBrowser();
    const slowOpening = {
      newContext: async (options?: Parameters<Browser["newContext"]>[0]) => {
        await Bun.sleep(1500);
        return real.newContext(options);
      },
    } as unknown as Browser;
    const result = await runCase({
      browser: slowOpening,
      execute: () => Effect.void,
      timeouts: testTimeouts({ browserAction: 500 }),
    });
    await result.closeScope();

    expect(annotation(result.observations)).toEqual([
      {
        caseId: result.id,
        failureKind: "timeout",
        outcome: "timed_out",
        scope: "annotation",
      },
    ]);
    expect(await artifactFiles(result.artifactDir)).toEqual([
      "browser-diagnostics.txt",
      "console.txt",
      "error.txt",
      "errors.txt",
      "network-requests.txt",
      "network.har",
      "snapshot-interactive.txt",
    ]);
  },
  caseTestTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "overlaps reservation cleanup with the browser close",
  async () => {
    let cleanupActive = false;
    let closedDuringCleanup = false;
    const contextClosed = Promise.withResolvers<void>();
    // Cleanup holds until the context closes, so a serial finalization
    // deadlocks and fails on the case bound instead of racing a clock.
    const cleanup = Layer.succeed(WorkspaceE2ECleanupService, {
      cleanupCheckoutStates: () => Effect.succeed(undefined),
      cleanupOwnedCheckoutStates: () =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            cleanupActive = true;
          }),
          () => Effect.promise(() => contextClosed.promise),
          () =>
            Effect.sync(() => {
              cleanupActive = false;
            })
        ).pipe(Effect.as(undefined)),
    });
    const result = await runCase({
      cleanup,
      execute: ({ openSession, runStep }) =>
        runStep({
          execute: Effect.gen(function* () {
            yield* openCasePage(openSession, `${origin()}/`);
            const context = yield* caseContext(openSession);
            context.once("close", () => {
              closedDuringCleanup = cleanupActive;
              contextClosed.resolve();
            });
          }),
          id: "open-checkout",
          timeoutMs: 10_000,
        }),
    });
    await result.closeScope();

    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(closedDuringCleanup).toBe(true);
  },
  caseTestTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "fails finalization when the context close outlasts the cleanup bound",
  async () => {
    const stalling = stallingContextClose();
    const result = await runCase({
      browser: stalling.browser,
      execute: ({ openSession, runStep }) =>
        runStep({
          execute: openCasePage(openSession, `${origin()}/`),
          id: "open-checkout",
          timeoutMs: 10_000,
        }),
      timeouts: testTimeouts({ cleanupAction: 1000 }),
    }).catch(async (error: unknown) => {
      await stalling.release();
      throw error;
    });
    // The case settled while its context close was still held, so the
    // cleanup bound, not the close, ended finalization.
    const heldCloses = stalling.closes();
    await stalling.release();
    await result.closeScope();

    expect(Exit.isFailure(result.exit)).toBe(true);
    if (Exit.isFailure(result.exit))
      expect(String(Cause.squash(result.exit.cause))).toContain(
        `Failed to finalize ${result.id} e2e case`
      );
    expect(annotation(result.observations)).toEqual([
      {
        caseId: result.id,
        failureKind: "defect",
        outcome: "failed",
        scope: "annotation",
      },
    ]);
    expect(heldCloses).toBe(1);
  },
  caseTestTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "bounds capture and close of a timed-out case whose close stalls",
  async () => {
    const stalling = stallingContextClose();
    const result = await runCase({
      browser: stalling.browser,
      execute: ({ openSession, runStep }) =>
        runStep({
          execute: openCasePage(openSession, `${origin()}/`).pipe(
            Effect.andThen(Effect.never)
          ),
          id: "wait-for-checkout",
          timeoutMs: 1500,
        }),
      timeouts: testTimeouts({ artifactCapture: 4000, cleanupAction: 1000 }),
    }).catch(async (error: unknown) => {
      await stalling.release();
      throw error;
    });
    const filesWhileStalled = await artifactFiles(result.artifactDir);
    await stalling.release();
    // The Scope shares the detached close, which exports once it finishes.
    await result.closeScope();

    // The stalled close fails finalization, which outranks the step timeout.
    expect(annotation(result.observations)).toEqual([
      {
        caseId: result.id,
        failureKind: "defect",
        outcome: "failed",
        scope: "annotation",
        stepId: "wait-for-checkout",
      },
    ]);
    // The capture read the page, then waited on the stalled close until its
    // own bound; the case settled without the HAR, which the close writes
    // when it finally finishes.
    expect(filesWhileStalled).toContain("snapshot-interactive.txt");
    expect(filesWhileStalled).not.toContain("network.har");
    expect(await artifactFiles(result.artifactDir)).toContain("network.har");
  },
  caseTestTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "cuts a capture that hangs on the page at its bound and keeps the failure",
  async () => {
    const hold = holdPage();
    // The page stays stuck until the case starts closing its context, so
    // only the capture's own bound can end the capture.
    const result = await runCase({
      browser: browserClosingWith(hold.release),
      execute: ({ openSession, runStep }) =>
        runStep({
          execute: Effect.gen(function* () {
            yield* openCasePage(openSession, `${origin()}${hold.path}`);
            // The page's main thread is now stuck, so the capture's page
            // reads can't return.
            yield* Effect.promise(() => hold.blocked);
            return yield* workspaceE2EError("synthetic checkout failure");
          }),
          id: "submit-checkout",
          timeoutMs: 10_000,
        }),
      timeouts: testTimeouts({ artifactCapture: 1500 }),
    }).finally(hold.release);
    await result.closeScope();

    expect(annotation(result.observations)).toEqual([
      {
        caseId: result.id,
        failureKind: "error",
        outcome: "failed",
        scope: "annotation",
        stepId: "submit-checkout",
      },
    ]);
    expect(await artifactFiles(result.artifactDir)).toEqual(["error.txt"]);
  },
  caseTestTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "continues without a browser that fails to open and fails its first browser step",
  async () => {
    const closed = await chromium.launch({ headless: true });
    await closed.close();
    const result = await runCase({
      browser: closed,
      execute: ({ openSession, runStep }) =>
        runStep({
          execute: openCasePage(openSession, `${origin()}/`),
          id: "open-checkout",
          timeoutMs: 10_000,
        }),
    });
    await result.closeScope();

    expect(annotation(result.observations)).toEqual([
      {
        caseId: result.id,
        failureKind: "error",
        outcome: "failed",
        scope: "annotation",
        stepId: "open-checkout",
      },
    ]);
    expect(await artifactFiles(result.artifactDir)).toEqual(["error.txt"]);
  },
  caseTestTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "times out diagnostics start on a browser that never opens",
  async () => {
    const opening = Promise.withResolvers<BrowserContext>();
    const neverOpens = {
      newContext: () => opening.promise,
    } as unknown as Browser;
    const result = await runCase({
      browser: neverOpens,
      execute: () => Effect.void,
      timeouts: testTimeouts({ browserAction: 500, cleanupAction: 500 }),
    });
    // The Scope's close waits for the opening, then closes the context that
    // arrives late, so nothing outlives the Scope.
    const late = await realBrowser().newContext();
    const lateClosed = Promise.withResolvers<void>();
    late.once("close", () => lateClosed.resolve());
    const scopeClosed = result.closeScope();
    opening.resolve(late);
    await scopeClosed;
    await lateClosed.promise;

    // The browser close still waits for the opening within its bound and
    // fails finalization.
    expect(annotation(result.observations)).toEqual([
      {
        caseId: result.id,
        failureKind: "defect",
        outcome: "failed",
        scope: "annotation",
      },
    ]);
    expect(
      result.observations.some(
        (observation) =>
          observation.scope === "phase" && observation.outcome === "failed"
      )
    ).toBe(true);
    expect(await artifactFiles(result.artifactDir)).toEqual(["error.txt"]);
  },
  caseTestTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "closes an interrupted case's context without capture or annotation",
  async () => {
    const id = `case-${randomUUID()}`;
    const scope = Scope.makeUnsafe("parallel");
    const observations: E2ETelemetryObservation[] = [];
    const opened = Promise.withResolvers<BrowserContext>();
    const fiber = Effect.runFork(
      runWorkspaceE2ECase({
        artifactRoot,
        browser: realBrowser(),
        datasourceConfig: testDatasourceConfig,
        sessionPrefix,
        testCase: {
          checkoutStates: [],
          execute: ({ openSession, runStep }) =>
            runStep({
              execute: Effect.gen(function* () {
                yield* openCasePage(openSession, `${origin()}/`);
                opened.resolve(yield* caseContext(openSession));
                return yield* Effect.never;
              }),
              id: "wait-for-checkout",
              timeoutMs: 10_000,
            }),
          id,
          timeoutMs: 20_000,
        },
        timeouts: testTimeouts(),
      }).pipe(Scope.provide(scope), Effect.provide(suiteLayer(observations)))
    );
    const context = await opened.promise;
    await Effect.runPromise(Fiber.interrupt(fiber));
    const closedBeforeScope = !realBrowser().contexts().includes(context);
    await runUntracedE2EEffect(Scope.close(scope, Exit.void));

    expect(closedBeforeScope).toBe(true);
    expect(annotation(observations)).toEqual([]);
    expect(await artifactFiles(join(artifactRoot, id))).toEqual([]);
  },
  caseTestTimeoutMs
);
