import { afterAll, beforeAll, expect, test } from "bun:test";
import { AssertionError } from "node:assert";
import { randomUUID } from "node:crypto";
import { type Browser, chromium, type Page } from "@playwright/test";
import { Effect } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import {
  type ActionResponseOutcome,
  openAdminSession,
  primePreviewBypass,
  retainServerActionSubmission,
} from "./admin-case";
import { E2EBrowserSession } from "./browser-session";
import { runE2ECase } from "./case-runner";
import {
  isWorkspaceE2ETimeout,
  type WorkspaceE2EError,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "./errors";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "./services/telemetry.mock";

// Admin cleanup closes the session before it awaits a retained Server Action
// submission, so no late request can leave the browser. These pin how a
// retained submission settles around that close, and how the case runner
// classifies an admin step's failures, against a real Chromium.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let heldAction: PromiseWithResolvers<Response> | undefined;
let heldActionArrived: PromiseWithResolvers<void> | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/action") {
        if (heldAction) {
          heldActionArrived?.resolve();
          return heldAction.promise;
        }
        return new Response("saved");
      }
      return new Response(
        `<!doctype html><title>Admin</title>
        <button id="submit" onclick="fetch('/action', { method: 'POST', headers: { 'next-action': 'synthetic' }, body: 'x' })">Save</button>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    },
  });
});

afterAll(async () => {
  await browser?.close();
  await server?.stop(true);
});

const origin = () => {
  if (!server) throw new Error("test server is not running");
  return `http://localhost:${server.port}`;
};

/**
 * Opens the admin page, retains the next Server Action submission, runs
 * `act`, closes the session, and only then awaits the submission, as admin
 * cleanup does.
 */
const submitAndClose = (act: (page: Page) => Promise<void>) => {
  if (!browser) throw new Error("Chromium is not running");
  const opening = E2EBrowserSession.open({
    browser,
    id: `admin-case-test-${randomUUID()}`,
    recordHar: false,
  });
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* opening;
        let submission: Promise<ActionResponseOutcome> | undefined;
        yield* session.use("submit the admin form", async (page) => {
          await page.goto(`${origin()}/`);
          submission = retainServerActionSubmission(page, origin());
          await act(page);
        });
        yield* session.close();
        return yield* Effect.promise(
          () => submission ?? Promise.reject(new Error("no submission"))
        );
      })
    )
  );
};

test.skipIf(!chromiumAvailable)(
  "settles a submission the browser never sent as undispatched once the session closes",
  async () => {
    expect(await submitAndClose(async () => undefined)).toEqual({
      kind: "undispatched",
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "settles a sent submission through its response",
  async () => {
    expect(
      await submitAndClose(async (page) => {
        const answered = page.waitForResponse(`${origin()}/action`);
        await page.locator("#submit").click();
        await answered;
      })
    ).toEqual({ kind: "responded" });
  }
);

test.skipIf(!chromiumAvailable)(
  "settles a sent submission still awaiting its response as unresolved",
  async () => {
    heldAction = Promise.withResolvers<Response>();
    heldActionArrived = Promise.withResolvers<void>();
    const arrived = heldActionArrived.promise;
    try {
      expect(
        await submitAndClose(async (page) => {
          await page.locator("#submit").click();
          await arrived;
        })
      ).toEqual({ kind: "unresolved" });
    } finally {
      heldAction.resolve(new Response("late"));
      heldAction = undefined;
    }
  }
);

// A Workspace deployment origin, the only kind that receives the secret; the
// probe's `fetch` holds it until the probe gives up.
const deploymentOrigin =
  "https://deskohub-workspace-abc123def-synthetic.vercel.app";
const heldProbeFetch = ((_input: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  })) as typeof fetch;

/**
 * Runs one admin case step through the case runner on an admin session and
 * returns the step's annotation, as the reporter would see it.
 */
const runAdminStep = async (input: {
  readonly browser?: Browser;
  readonly execute: (
    session: E2EBrowserSession
  ) => Effect.Effect<unknown, WorkspaceE2EError>;
  readonly timeoutMs?: number;
}) => {
  if (!browser) throw new Error("Chromium is not running");
  const observations: E2ETelemetryObservation[] = [];
  const failures: WorkspaceE2EError[] = [];
  await Effect.runPromiseExit(
    runE2ECase({
      body: (step) =>
        step({
          execute: Effect.scoped(
            Effect.flatMap(
              openAdminSession({
                baseURL: origin(),
                browser: input.browser ?? browser,
                caseName: `admin-case-test-${randomUUID()}`,
                fetch: heldProbeFetch,
              }),
              ({ session }) => input.execute(session)
            )
          ).pipe(
            Effect.tapError((failure) =>
              Effect.sync(() => failures.push(failure))
            ),
            Effect.asVoid
          ),
          id: "admin-step",
          timeoutMs: input.timeoutMs ?? 5000,
        }),
      caseId: "admin-case",
      watchdogMs: (input.timeoutMs ?? 5000) + 5000,
    }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
  );
  return {
    annotations: observations
      .filter(({ scope }) => scope === "annotation")
      .map(({ scope: _scope, ...annotation }) => annotation),
    failures,
  };
};

const annotateAdminStep = async (input: Parameters<typeof runAdminStep>[0]) =>
  (await runAdminStep(input)).annotations.map(({ failureKind, outcome }) => ({
    failureKind,
    outcome,
  }));

const failed = [
  { failureKind: "error", outcome: "failed" } as const,
];
const timedOut = [
  { failureKind: "timeout", outcome: "timed_out" } as const,
];

test.skipIf(!chromiumAvailable)(
  "fails an admin step on a Playwright timeout inside it",
  async () => {
    expect(
      await annotateAdminStep({
        execute: (session) =>
          session.use("wait for the admin form", async (page) => {
            await page.goto(`${origin()}/`);
            await page.locator("#missing").waitFor({ timeout: 50 });
          }),
      })
    ).toEqual(failed);
  }
);

test.skipIf(!chromiumAvailable)(
  "fails an admin step when opening its browser times out",
  async () => {
    const timingOut = {
      newContext: () =>
        Promise.reject(
          Object.assign(new Error("synthetic browser timeout"), {
            name: "TimeoutError",
          })
        ),
    } as unknown as Browser;
    expect(
      await annotateAdminStep({
        browser: timingOut,
        execute: () => Effect.void,
      })
    ).toEqual(failed);
  }
);

test.skipIf(!chromiumAvailable)(
  "fails an admin step when its preview access probe times out",
  async () => {
    expect(
      await annotateAdminStep({
        execute: (session) =>
          session.primePreviewAccess(
            `${deploymentOrigin}/en-US/admin`,
            "synthetic-held-bypass",
            { timeoutMs: 50 }
          ),
      })
    ).toEqual(failed);
  }
);

test.skipIf(!chromiumAvailable)(
  "still times out an admin step at its own deadline",
  async () => {
    expect(
      await annotateAdminStep({
        execute: (session) =>
          session.use("wait for the admin form", async (page) => {
            await page.goto(`${origin()}/`);
            await page.locator("#missing").waitFor({ timeout: 5000 });
          }),
        timeoutMs: 200,
      })
    ).toEqual(timedOut);
  }
);

test.skipIf(!chromiumAvailable)(
  "still times out an admin call at its own deadline",
  async () => {
    const forever = () => new Promise<never>(() => undefined);
    expect([
      await annotateAdminStep({
        execute: (session) =>
          session.use("wait forever", forever, { timeoutMs: 50 }),
      }),
      await annotateAdminStep({
        execute: (session) =>
          session.evaluate("evaluate forever", forever, undefined, {
            timeoutMs: 50,
          }),
      }),
    ]).toEqual([timedOut, timedOut]);
  }
);

// The parity steps fail on their own, so a generous deadline keeps a slow
// browser start from turning them into timeouts.
const parityStepTimeoutMs = 15_000;

// Before the session, admin steps ran their browser callbacks through
// `sanitizedBrowserOperation`: an `AssertionError` kept its message, and any
// other thrown value, a `WorkspaceE2EError` and its diagnostic code included,
// became a fixed failure of the operation. The C03 annotation and the step's
// failure stay as they were then.
const assertion = new AssertionError({ message: "synthetic assertion" });
const failedAdminStep = [
  {
    caseId: "admin-case",
    failureKind: "error",
    outcome: "failed",
    stepId: "admin-step",
  } as const,
];
const describeFailure = (failure: WorkspaceE2EError) => ({
  cause: failure.cause,
  causes: failure.causes,
  diagnosticCode: failure.diagnosticCode,
  message: failure.message,
  operation: failure.operation,
  timeout: isWorkspaceE2ETimeout(failure),
});
const baseFailure = (label: string, kept = "") => ({
  cause: undefined,
  causes: undefined,
  diagnosticCode: undefined,
  message: `${label} failed${kept}`,
  operation: label,
  timeout: false,
});
const callbackFailures: ReadonlyArray<
  readonly [shape: string, thrown: () => unknown, kept?: string]
> = [
  ["a plain Error", () => new Error("synthetic error")],
  ["an AssertionError", () => assertion, `: ${assertion.message}`],
  [
    "a WorkspaceE2EError with a diagnostic code",
    () =>
      workspaceE2EError("synthetic row assertion", {
        diagnosticCode: "postgres_checkout_row_assertion_failed",
        operation: "assert the synthetic row",
      }),
  ],
  [
    "a WorkspaceE2EError without a code",
    () =>
      workspaceE2EError("synthetic step failure", {
        operation: "inspect the synthetic row",
      }),
  ],
  [
    "a WorkspaceE2EError timeout",
    () =>
      workspaceE2ETimeoutError("synthetic wait timed out", {
        diagnosticCode: "postgres_checkout_row_assertion_failed",
        operation: "wait for the synthetic row",
      }),
  ],
  [
    "a Playwright timeout",
    () =>
      Object.assign(new Error("synthetic Playwright timeout"), {
        name: "TimeoutError",
      }),
  ],
  ["a non-Error value", () => "synthetic thrown string"],
];

for (const [shape, thrown, kept] of callbackFailures) {
  test.skipIf(!chromiumAvailable)(
    `reports ${shape} thrown by an admin callback as it did before the session`,
    async () => {
      const label = "drive the admin form";
      const { annotations, failures } = await runAdminStep({
        execute: (session) =>
          session.use(label, async () => {
            throw thrown();
          }),
        timeoutMs: parityStepTimeoutMs,
      });
      expect({ annotations, failures: failures.map(describeFailure) }).toEqual({
        annotations: failedAdminStep,
        failures: [baseFailure(label, kept)],
      });
    }
  );
}

test.skipIf(!chromiumAvailable)(
  "reports a failed admin page evaluation as it did before the session",
  async () => {
    const label = "read the admin form";
    const { annotations, failures } = await runAdminStep({
      execute: (session) =>
        session.evaluate(
          label,
          () => {
            throw new Error("synthetic page error");
          },
          undefined
        ),
      timeoutMs: parityStepTimeoutMs,
    });
    expect({ annotations, failures: failures.map(describeFailure) }).toEqual({
      annotations: failedAdminStep,
      failures: [baseFailure(label)],
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "reports an admin call cut off by the session's close as it did before the session",
  async () => {
    const label = "read the admin title";
    const { annotations, failures } = await runAdminStep({
      execute: (session) =>
        Effect.andThen(
          session.close(),
          session.use(label, (page) => page.title())
        ),
      timeoutMs: parityStepTimeoutMs,
    });
    expect({ annotations, failures: failures.map(describeFailure) }).toEqual({
      annotations: failedAdminStep,
      failures: [baseFailure(label)],
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "fails a context's preview access priming instead of timing it out",
  async () => {
    if (!browser) throw new Error("Chromium is not running");
    const context = await browser.newContext();
    try {
      const failure = await Effect.runPromise(
        Effect.flip(
          primePreviewBypass({
            bypassSecret: "synthetic-held-bypass",
            context,
            fetch: heldProbeFetch,
            origin: deploymentOrigin,
            timeoutMs: 50,
          })
        )
      );
      expect(isWorkspaceE2ETimeout(failure)).toBe(false);
      expect(failure.operation).toBe(
        "prime the Vercel protection bypass cookie"
      );
    } finally {
      await context.close();
    }
  }
);
