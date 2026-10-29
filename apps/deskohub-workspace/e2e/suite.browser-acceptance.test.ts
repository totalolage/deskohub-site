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
import { runBrowserCommand } from "./browser";
import { sanitizeHarArtifact } from "./artifact-sanitization";
import type { DatasourceConfig } from "./config";
import { WorkspaceE2EHostedPaymentPermitServiceMock } from "./coordination/hosted-payment-permit.service.mock";
import { WorkspaceE2EProviderVerificationPermitServiceMock } from "./coordination/provider-verification-permit.service.mock";
import { runUntracedE2EEffect } from "./effect-edge";
import { workspaceE2EError } from "./errors";
import { E2EDatabase } from "./integrations/database.service";
import {
  addRedaction,
  browserSessionFor,
  makePlaywrightBrowserRunner,
  type Runner,
} from "./runtime";
import { WorkspaceE2ECleanupService } from "./services/cleanup";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "./services/telemetry.mock";
import { runWorkspaceE2ECase } from "./suite";
import { type WorkspaceE2ETimeouts, workspaceE2ETimeouts } from "./timeouts";
import type { WorkspaceE2ECase } from "./types";

// A checkout case's browser lifecycle on a real Chromium, through the real
// argv runner and the C03 case runner, with the runner owned by a test Scope
// as the checkout fixture owns it.
const chromiumAvailable = await playwrightChromiumAvailable();
const pageSecret = "synthetic-suite-page-secret";
const sessionPrefix = "suite-test";
// Above the cases' 25 s bound plus one browser-action session release.
const caseTestTimeoutMs = 60_000;
let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let artifactRoot = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  addRedaction(pageSecret);
  artifactRoot = await mkdtemp(join(tmpdir(), "suite-test-"));
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/api")
        return Response.json({ echoed: request.headers.get("authorization") });
      const script =
        pathname === "/busy"
          ? "setTimeout(() => { for (;;) {} }, 50);"
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

/** One case as the checkout fixture runs it: its runner in a test Scope. */
const runCase = async (input: {
  readonly browser?: Browser;
  readonly cleanup?: Layer.Layer<WorkspaceE2ECleanupService>;
  readonly execute: WorkspaceE2ECase["execute"];
  readonly id?: string;
  readonly timeouts?: WorkspaceE2ETimeouts;
}) => {
  const id = input.id ?? `case-${randomUUID()}`;
  const scope = Scope.makeUnsafe("parallel");
  const run = makePlaywrightBrowserRunner(input.browser ?? realBrowser(), {
    scope,
  });
  const observations: E2ETelemetryObservation[] = [];
  const exit = await Effect.runPromiseExit(
    runWorkspaceE2ECase({
      artifactRoot,
      datasourceConfig: testDatasourceConfig,
      run,
      sessionPrefix,
      testCase: {
        checkoutStates: [],
        execute: input.execute,
        id,
        timeoutMs: 20_000,
      },
      timeouts: input.timeouts ?? testTimeouts(),
    }).pipe(
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
    run,
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

/** An argv `open`, as the unmigrated case modules navigate. */
const openPage = (run: Runner, session: string, url: string) =>
  runBrowserCommand("open browser page", run, session, ["open", url], {
    logCommand: false,
    logOutput: false,
    timeoutMs: 10_000,
  });

/** The case's own browser context, read through the session bridge. */
const caseContext = (run: Runner, sessionId: string) =>
  browserSessionFor(run, sessionId).pipe(
    Effect.flatMap((session) =>
      session.use("read the context", async (page) => page.context())
    )
  );

/** A browser whose contexts hold `close()` until the test lets go. */
const stallingContextClose = () => {
  const real = realBrowser();
  const held = Promise.withResolvers<void>();
  const contexts: BrowserContext[] = [];
  return {
    browser: {
      newContext: async (options?: Parameters<Browser["newContext"]>[0]) => {
        const context = await real.newContext(options);
        contexts.push(context);
        context.close = () => held.promise;
        return context;
      },
    } as unknown as Browser,
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

test.skipIf(!chromiumAvailable)(
  "passes a case in its own session and closes it during finalization",
  async () => {
    let context: BrowserContext | undefined;
    let caseRunner: Runner | undefined;
    let sessionId = "";
    const result = await runCase({
      execute: ({ run, runStep, session }) =>
        runStep({
          execute: Effect.gen(function* () {
            caseRunner = run;
            sessionId = session;
            yield* openPage(run, session, `${origin()}/`);
            context = yield* caseContext(run, session);
          }),
          id: "open-checkout",
          timeoutMs: 10_000,
        }),
    });
    const closedBeforeScope = !realBrowser()
      .contexts()
      .includes(context as BrowserContext);
    await result.closeScope();

    expect(Exit.isSuccess(result.exit)).toBe(true);
    // The case drives the test's own runner, which the suite hands it.
    expect(caseRunner).toBe(result.run);
    expect(sessionId).toBe(`${sessionPrefix}-${result.id}`);
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
      execute: ({ run, runStep, session }) =>
        runStep({
          execute: Effect.gen(function* () {
            const context = yield* caseContext(run, session);
            const [page] = context.pages();
            if (!page) return yield* workspaceE2EError("no checkout page");
            // Listening before the navigation, which starts the request.
            const answered = page.waitForResponse((response) =>
              response.url().includes("/api")
            );
            yield* openPage(run, session, `${origin()}/?token=${pageSecret}`);
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
 * The HAR the argv failure capture exported for the same page: the session's
 * recording options, sanitized by the session's close and again by the
 * capture.
 */
const recordArgvCaptureHar = async (url: string) => {
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
  "exports the settled responses the argv failure capture exported",
  async () => {
    const result = await runCase({
      execute: ({ run, runStep, session }) =>
        runStep({
          execute: Effect.gen(function* () {
            const context = yield* caseContext(run, session);
            const [page] = context.pages();
            if (!page) return yield* workspaceE2EError("no checkout page");
            // Listening before the navigation, which starts the request.
            const finished = apiRequestFinished(page);
            yield* openPage(run, session, `${origin()}/`);
            yield* Effect.promise(() => finished);
            return yield* workspaceE2EError("synthetic checkout failure");
          }),
          id: "submit-checkout",
          timeoutMs: 10_000,
        }),
    });
    await result.closeScope();
    const har = await readFile(join(result.artifactDir, "network.har"), "utf8");
    const reference = await recordArgvCaptureHar(`${origin()}/`);

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
      execute: ({ run, runStep, session }) =>
        runStep({
          execute: openPage(run, session, `${origin()}/`).pipe(
            Effect.andThen(Effect.never)
          ),
          id: "wait-for-checkout",
          timeoutMs: 1000,
        }),
    });
    await timedOut.closeScope();
    const coded = await runCase({
      execute: ({ run, runStep, session }) =>
        runStep({
          execute: openPage(run, session, `${origin()}/`).pipe(
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
      execute: ({ run, runStep, session }) =>
        runStep({
          execute: Effect.gen(function* () {
            yield* openPage(run, session, `${origin()}/`);
            const context = yield* caseContext(run, session);
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
    const startedAt = Date.now();
    const result = await runCase({
      browser: stalling.browser,
      execute: ({ run, runStep, session }) =>
        runStep({
          execute: openPage(run, session, `${origin()}/`),
          id: "open-checkout",
          timeoutMs: 10_000,
        }),
      timeouts: testTimeouts({ cleanupAction: 1000 }),
    }).finally(stalling.release);
    const elapsed = Date.now() - startedAt;
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
    expect(elapsed).toBeLessThan(10_000);
  },
  caseTestTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "bounds capture and close of a timed-out case whose close stalls",
  async () => {
    const stalling = stallingContextClose();
    const result = await runCase({
      browser: stalling.browser,
      execute: ({ run, runStep, session }) =>
        runStep({
          execute: openPage(run, session, `${origin()}/`).pipe(
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

    // The stalled close fails finalization, which outranks the step timeout,
    // as the stalled argv HAR stop and close did.
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
    const startedAt = Date.now();
    const result = await runCase({
      execute: ({ run, runStep, session }) =>
        runStep({
          execute: Effect.gen(function* () {
            yield* openPage(run, session, `${origin()}/busy`);
            // The page's main thread is now stuck, so no page read returns.
            yield* Effect.sleep("300 millis");
            return yield* workspaceE2EError("synthetic checkout failure");
          }),
          id: "submit-checkout",
          timeoutMs: 10_000,
        }),
      timeouts: testTimeouts({ artifactCapture: 1500 }),
    });
    const elapsed = Date.now() - startedAt;
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
    expect(elapsed).toBeLessThan(15_000);
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
      execute: ({ run, runStep, session }) =>
        runStep({
          execute: openPage(run, session, `${origin()}/`),
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
    await result.closeScope();
    // A context that arrives after the Scope closed is closed at once.
    const late = await realBrowser().newContext();
    const lateClosed = Promise.withResolvers<void>();
    late.once("close", () => lateClosed.resolve());
    opening.resolve(late);
    await lateClosed.promise;

    // The browser close still waits for the opening within its bound and
    // fails finalization, as the argv close of a pending session did.
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
    const runner = makePlaywrightBrowserRunner(realBrowser(), { scope });
    const observations: E2ETelemetryObservation[] = [];
    const opened = Promise.withResolvers<BrowserContext>();
    const fiber = Effect.runFork(
      runWorkspaceE2ECase({
        artifactRoot,
        datasourceConfig: testDatasourceConfig,
        run: runner,
        sessionPrefix,
        testCase: {
          checkoutStates: [],
          execute: ({ run, runStep, session }) =>
            runStep({
              execute: Effect.gen(function* () {
                yield* openPage(run, session, `${origin()}/`);
                opened.resolve(yield* caseContext(run, session));
                return yield* Effect.never;
              }),
              id: "wait-for-checkout",
              timeoutMs: 10_000,
            }),
          id,
          timeoutMs: 20_000,
        },
        timeouts: testTimeouts(),
      }).pipe(Effect.provide(suiteLayer(observations)))
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
