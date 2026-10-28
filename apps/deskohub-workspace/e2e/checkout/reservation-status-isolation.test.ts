import "../../shared/polyfills/temporal";

import { afterAll, beforeAll, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { type Browser, chromium } from "@playwright/test";
import { Effect, Exit } from "effect";
import { customerAccounts } from "@/db/schema/customer-accounts";
import { m } from "@/features/i18n";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { runE2ECase } from "../case-runner";
import type { WorkspaceE2EConfig } from "../config";
import { isWorkspaceE2ETimeout, type WorkspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { browserSessionFor, makePlaywrightBrowserRunner } from "../runtime";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "../services/telemetry.mock";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutRow } from "../types";
import { assertReservationStatusIsolation } from "./reservation-status-isolation";

const chromiumAvailable = await playwrightChromiumAvailable();

const orderId = "019f70bd-0131-7f30-9f8a-48e768f00292";
const customerId = "dotypos-customer-paid";
const targetStatusPath = `/en-US/reservation/status/${orderId}`;
const signInPath = "/en-US/auth/sign-in";
const bookingSession = "meeting-room-paid-test";
const signedInCookie = "workspace-e2e-signed-in";
const caseId = "reservation-status-isolation";
const stepId = "assert-reservation-status-isolation";
const stepTimeoutMs = 45_000;
const caseWatchdogMs = 60_000;
// The watchdog, then the case Scope's bounded browser close, with headroom.
const testTimeoutMs =
  caseWatchdogMs + workspaceE2ETimeouts.browserAction + 15_000;

const targetRow = {
  dotypos_customer_id: customerId,
  fulfillment_state: "failed",
  payment_state: "paid",
  reservation_id: orderId,
} as CheckoutRow;

/**
 * How the synthetic Workspace answers status requests: `scoped` is the real
 * contract; the others each break one isolation rule.
 */
type IsolationMode =
  | "scoped"
  | "session-reads-every-order"
  | "signed-out-reads-status"
  | "status-url-drifts";

let mode: IsolationMode = "scoped";
const requests: { readonly path: string; readonly signedIn: boolean }[] = [];
// When the booking session first asked for the target status after the
// signed-out check, which is where the case resumes after that browser's close.
let authorizedStatusRequestedAt: number | undefined;

const page = (body: string) =>
  new Response(`<!doctype html><html lang="en"><body>${body}</body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

const supportStatus = (shownOrderId: string) =>
  page(`<h1>We couldn't deliver your confirmation.</h1>
    <p>Your payment went through and your reservation is saved, but your confirmation and access link didn't reach your email.</p>
    <dl><dt>Order reference</dt><dd>${shownOrderId}</dd></dl>
    <a id="checkout-status-support-contact" href="/en-US/contact">Send support request</a>`);

const server = Bun.serve({
  fetch: (request) => {
    const url = new URL(request.url);
    const signedIn =
      request.headers.get("cookie")?.includes(`${signedInCookie}=1`) ?? false;
    requests.push({ path: url.pathname, signedIn });
    if (signedIn && url.pathname === targetStatusPath)
      authorizedStatusRequestedAt ??= Date.now();
    if (url.pathname === "/en-US/contact") return page("<h1>Contact</h1>");
    if (url.pathname === signInPath)
      return page(
        `<h1>${m.accountSignInReservationTitle({}, { locale: "en-US" })}</h1>`
      );
    const statusOrderId = url.pathname.match(
      /^\/en-US\/reservation\/status\/([^/]+)$/
    )?.[1];
    if (!statusOrderId) return new Response("Not found", { status: 404 });
    if (mode === "status-url-drifts" && !url.searchParams.has("drifted"))
      return Response.redirect(
        new URL(`${url.pathname}?drifted=1`, url).toString(),
        307
      );
    // A leaking page still says it found nothing but links the order's
    // support request.
    if (statusOrderId !== orderId)
      return page(
        `<h1>We could not find this order.</h1>${
          mode === "session-reads-every-order"
            ? '<a id="checkout-status-support-contact" href="/en-US/contact">Send support request</a>'
            : ""
        }`
      );
    if (!signedIn && mode !== "signed-out-reads-status")
      return Response.redirect(
        new URL(
          `${signInPath}?${new URLSearchParams({
            for: "reservation",
            returnTo: url.pathname,
          })}`,
          url
        ).toString(),
        307
      );
    return supportStatus(orderId);
  },
  hostname: "127.0.0.1",
  port: 0,
});
const baseUrl = server.url.origin;
const originalUrl = `${baseUrl}/en-US/contact?email=${encodeURIComponent(testEmailAddress("synthetic"))}&message=${orderId}`;

const config: WorkspaceE2EConfig = {
  baseUrl,
  bypassSecret: undefined,
  expectedHost: new URL(baseUrl).host,
  timeouts: {
    ...workspaceE2ETimeouts,
    // Long enough for a loaded machine; the failure paths wait them out.
    browserAction: 10_000,
    browserNavigation: 10_000,
    uiTransition: 10_000,
  },
};

let browser: Browser | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  await server.stop(true);
});

/**
 * `cleanupConverges: false` keeps the isolation fixture's reservation after
 * its delete, so the fixture's cleanup check fails.
 */
const makeDatabase = ({ cleanupConverges = true } = {}) => {
  const rows = new Map<string, unknown>([[orderId, targetRow]]);
  let lastInsertedId: string | undefined;

  const makeSelect = (selection: Record<string, unknown>) => {
    if (Object.hasOwn(selection, "reservation_id")) {
      const query = {
        from: () => query,
        leftJoin: () => query,
        where: () => ({
          limit: () => Effect.succeed(rows.has(orderId) ? [targetRow] : []),
        }),
      };
      return query;
    }

    return {
      from: () => ({
        where: () =>
          Effect.sync(() =>
            lastInsertedId && rows.has(lastInsertedId)
              ? [{ id: lastInsertedId }]
              : []
          ),
      }),
    };
  };

  type InsertedRow = { readonly id?: string };
  // The fixture inserts reservations as a batch and reads them back.
  const storeReservations = (inserted: InsertedRow | readonly InsertedRow[]) =>
    Effect.sync(() => {
      const batch = [inserted].flat();
      for (const row of batch) {
        if (!row.id) throw new Error("fixture reservation id missing");
        lastInsertedId = row.id;
        rows.set(row.id, row);
      }
      return batch;
    });
  const insert = (table: unknown) => ({
    values: (inserted: InsertedRow | readonly InsertedRow[]) =>
      // The fixture's synthetic reservation author isn't a reservation row.
      table === customerAccounts
        ? Effect.void
        : { returning: () => storeReservations(inserted) },
  });

  const makeTransaction = () => ({ insert, select: makeSelect });

  const db = {
    delete: () => ({
      where: () =>
        Effect.sync(() => {
          if (cleanupConverges && lastInsertedId) rows.delete(lastInsertedId);
        }),
    }),
    insert,
    select: makeSelect,
    transaction: (
      use: (transaction: ReturnType<typeof makeTransaction>) => unknown
    ) => use(makeTransaction()),
  };

  return {
    db: db as never,
    hasOnlyTarget: () => rows.size === 1 && rows.has(orderId),
  };
};

/**
 * Holds one step of the signed-out visitor's context, the second one the
 * runner opens, over real Chromium: its opening, or its close, which either
 * fails or never settles. `release` lets held work finish and closes a context
 * whose close failed, so nothing outlives the test.
 */
type SignedOutContextHold = "close-fails" | "close-held" | "open-held";

const holdSignedOutContext = (
  real: Browser,
  hold: SignedOutContextHold | undefined
) => {
  const released = Promise.withResolvers<void>();
  const failedCloses: (() => Promise<void>)[] = [];
  let closeStartedAt: number | undefined;
  let contexts = 0;
  const newContext: Browser["newContext"] = async (options) => {
    contexts += 1;
    if (contexts !== 2 || hold === undefined) return real.newContext(options);
    if (hold === "open-held") await released.promise;
    const context = await real.newContext(options);
    const close = context.close.bind(context);
    context.close = async (closeOptions) => {
      closeStartedAt ??= Date.now();
      if (hold === "close-fails") {
        failedCloses.push(() => close(closeOptions));
        throw new Error("context close failed");
      }
      if (hold === "close-held") await released.promise;
      return close(closeOptions);
    };
    return context;
  };
  const browser = new Proxy(real, {
    get: (target, property) => {
      if (property === "newContext") return newContext;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    browser,
    closeStartedAt: () => closeStartedAt,
    release: async () => {
      released.resolve();
      await Promise.allSettled(
        failedCloses.map((closeContext) => closeContext())
      );
    },
  };
};

/**
 * Runs the isolation check as one step through the case runner, with the
 * booking session signed in on the support contact page it starts from.
 * Returns the C03 annotation, the step's failures with their operation and
 * timeout class, everything reported, the page the booking session ends on,
 * how many browser contexts are still open, and the database state.
 */
const runIsolation = async (
  isolationMode: IsolationMode = "scoped",
  {
    caseConfig = config,
    cleanupConverges,
    signedOutContext,
    stepTimeoutMs: isolationStepTimeoutMs = stepTimeoutMs,
  }: {
    readonly caseConfig?: WorkspaceE2EConfig;
    readonly cleanupConverges?: boolean;
    readonly signedOutContext?: SignedOutContextHold;
    readonly stepTimeoutMs?: number;
  } = {}
) => {
  if (!browser) throw new Error("Chromium is not running");
  const opened = browser;
  const held = holdSignedOutContext(opened, signedOutContext);
  mode = isolationMode;
  requests.length = 0;
  authorizedStatusRequestedAt = undefined;
  const database = makeDatabase({ cleanupConverges });
  const run = makePlaywrightBrowserRunner(held.browser, { recordHar: false });
  const observations: E2ETelemetryObservation[] = [];
  const failures: WorkspaceE2EError[] = [];
  const startedAt = Date.now();
  try {
    const exit = await Effect.runPromiseExit(
      runE2ECase({
        body: (step) =>
          Effect.gen(function* () {
            const booking = yield* browserSessionFor(run, bookingSession);
            yield* booking.use("sign the booking session in", async (page) => {
              await page
                .context()
                .addCookies([
                  { name: signedInCookie, url: baseUrl, value: "1" },
                ]);
              await page.goto(originalUrl);
            });
            yield* step({
              execute: assertReservationStatusIsolation({
                config: caseConfig,
                customerId: customerId as never,
                data: { locale: "en-US" },
                orderId: orderId as never,
                run,
                session: bookingSession,
              }).pipe(
                Effect.tapError((failure) =>
                  Effect.sync(() => failures.push(failure))
                ),
                Effect.provideService(E2EDatabase, E2EDatabase.of(database))
              ),
              id: stepId,
              timeoutMs: isolationStepTimeoutMs,
            });
          }),
        caseId,
        watchdogMs: caseWatchdogMs,
      }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
    );
    const elapsedMs = Date.now() - startedAt;
    const finalUrl = await Effect.runPromise(
      Effect.flatMap(browserSessionFor(run, bookingSession), (booking) =>
        booking.use("read the final URL", async (page) => page.url())
      )
    );
    const annotations = observations
      .filter(({ scope }) => scope === "annotation")
      .map(({ scope: _scope, ...annotation }) => annotation);
    return {
      annotations,
      database,
      elapsedMs,
      failures: failures.map((failure) => ({
        operation: failure.operation,
        timeout: isWorkspaceE2ETimeout(failure),
      })),
      finalUrl,
      // How long the case waited for the signed-out browser's close before
      // it went on to the booking session's checks.
      closeWaitMs:
        authorizedStatusRequestedAt === undefined ||
        held.closeStartedAt() === undefined
          ? undefined
          : authorizedStatusRequestedAt - (held.closeStartedAt() ?? 0),
      openContexts: opened.contexts().length,
      // The settled step spans, with their outcomes.
      steps: observations.flatMap(({ scope, ...observation }) =>
        scope === "step" ? [observation] : []
      ),
      reported: JSON.stringify({
        annotations,
        messages: failures.map(({ message }) => message),
      }),
      succeeded: Exit.isSuccess(exit),
    };
  } finally {
    await held.release();
    await run.close?.();
  }
};

const failedWith = (operation: string, failureKind: "error" | "timeout") => ({
  annotations: [
    failureKind === "timeout"
      ? { caseId, failureKind, outcome: "timed_out" as const, stepId }
      : { caseId, failureKind, outcome: "failed" as const, stepId },
  ],
  failures: [{ operation, timeout: failureKind === "timeout" }],
  succeeded: false,
});

const expectBookingSessionRestored = (
  result: Awaited<ReturnType<typeof runIsolation>>
) => {
  expect(new URL(result.finalUrl).pathname).toBe("/en-US/contact");
  // The signed-out visitor's browser is closed; the booking one stays open.
  expect(result.openContexts).toBe(1);
  expect(result.database.hasOnlyTarget()).toBe(true);
  expect(result.reported).not.toContain(orderId);
};

test.skipIf(!chromiumAvailable)(
  "checks target authorization, other-order isolation, and signed-out sign-in",
  async () => {
    const result = await runIsolation();

    expect({
      annotations: result.annotations,
      failures: result.failures,
      succeeded: result.succeeded,
    }).toEqual({ annotations: [], failures: [], succeeded: true });
    expectBookingSessionRestored(result);
    // The signed-out visitor asked for the target status without the
    // booking session's sign-in and landed on the reservation sign-in.
    expect(requests).toContainEqual({
      path: targetStatusPath,
      signedIn: false,
    });
    expect(requests).toContainEqual({ path: signInPath, signedIn: false });
    expect(requests).toContainEqual({ path: targetStatusPath, signedIn: true });
  },
  testTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "fails when the booking session reads every order",
  async () => {
    const result = await runIsolation("session-reads-every-order");

    expect({
      annotations: result.annotations,
      failures: result.failures,
      succeeded: result.succeeded,
    }).toEqual(failedWith("assert other reservation remains private", "error"));
    expect(result.reported).toContain(
      "other reservation details were exposed to the booking session"
    );
    expectBookingSessionRestored(result);
  },
  testTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "times out when a signed-out visitor reads the status page",
  async () => {
    const result = await runIsolation("signed-out-reads-status");

    expect({
      annotations: result.annotations,
      failures: result.failures,
      succeeded: result.succeeded,
    }).toEqual(
      failedWith(
        "wait for signed-out reservation status sign-in URL",
        "timeout"
      )
    );
    expectBookingSessionRestored(result);
  },
  testTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "times out unless the status page keeps the exact link",
  async () => {
    const result = await runIsolation("status-url-drifts");

    expect({
      annotations: result.annotations,
      failures: result.failures,
      succeeded: result.succeeded,
    }).toEqual(
      failedWith("wait for authorized reservation status URL", "timeout")
    );
    expectBookingSessionRestored(result);
  },
  testTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "times out at the step deadline while the signed-out browser opens",
  async () => {
    const result = await runIsolation("scoped", {
      signedOutContext: "open-held",
      stepTimeoutMs: 8_000,
    });

    // The step times out at its own deadline, without a diagnostic code. The
    // argv close awaited the pending open, so the step was cancelled only
    // after the case watchdog fired.
    expect({
      annotations: result.annotations,
      steps: result.steps,
      succeeded: result.succeeded,
    }).toEqual({
      annotations: failedWith("", "timeout").annotations,
      steps: [
        {
          caseId,
          failureKind: "timeout",
          outcome: "timed_out",
          stepId,
          timeoutMs: 8_000,
        },
      ],
      succeeded: false,
    });
    expect(result.elapsedMs).toBeLessThan(caseWatchdogMs);
    expect(new URL(result.finalUrl).pathname).toBe("/en-US/contact");
    expect(result.database.hasOnlyTarget()).toBe(true);
    expect(requests).not.toContainEqual({
      path: targetStatusPath,
      signedIn: false,
    });
  },
  testTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "annotates the diagnostic code of a fixture cleanup that does not converge",
  async () => {
    const result = await runIsolation("scoped", { cleanupConverges: false });

    expect({
      annotations: result.annotations,
      failures: result.failures,
      steps: result.steps,
      succeeded: result.succeeded,
    }).toEqual({
      annotations: [
        {
          caseId,
          diagnosticCode: "postgres_account_fixture_convergence_failed",
          failureKind: "error",
          outcome: "failed",
          stepId,
        },
      ],
      failures: [
        {
          operation: "verify local reservation fixture cleanup",
          timeout: false,
        },
      ],
      steps: [
        {
          caseId,
          failureKind: "error",
          outcome: "failed",
          stepId,
          timeoutMs: stepTimeoutMs,
        },
      ],
      succeeded: false,
    });
    expect(new URL(result.finalUrl).pathname).toBe("/en-US/contact");
    expect(result.openContexts).toBe(1);
  },
  testTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "ignores a signed-out browser close that fails",
  async () => {
    const result = await runIsolation("scoped", {
      signedOutContext: "close-fails",
    });

    expect(result.succeeded).toBe(true);
    expect(result.annotations).toEqual([]);
  },
  testTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "stops waiting for a signed-out browser close after its bound",
  async () => {
    const result = await runIsolation("scoped", {
      caseConfig: {
        ...config,
        timeouts: { ...config.timeouts, browserSessionClose: 1_000 },
      },
      signedOutContext: "close-held",
    });

    expect(result.succeeded).toBe(true);
    expect(result.annotations).toEqual([]);
    // The configured second, well short of the fixture's 10-second browser
    // action bound that would also end the wait.
    expect(result.closeWaitMs).toBeGreaterThanOrEqual(900);
    expect(result.closeWaitMs).toBeLessThan(8_000);
  },
  testTimeoutMs
);
