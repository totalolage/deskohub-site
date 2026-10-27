import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium } from "@playwright/test";
import { Effect, Exit } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { E2EBrowserSession } from "../browser-session";
import { runE2ECase } from "../case-runner";
import { isWorkspaceE2ETimeout, type WorkspaceE2EError } from "../errors";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "../services/telemetry.mock";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  waitForNoRememberedReferralCode,
  waitForRememberedReferralCode,
} from "./referral-cookie";

// The referral cookie waits read the session's value-free cookie description.
// These run the app's own writer in a real Chromium on an HTTPS origin, the
// only kind on which it marks the cookie Secure, routed inside the context.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let buildDirectory = "";
let harness = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  buildDirectory = await mkdtemp(join(tmpdir(), "referral-cookie-"));
  const build = await Bun.build({
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    entrypoints: [
      join(
        import.meta.dir,
        "../../features/referrals/remember-shared-referral-code.browser-harness.tsx"
      ),
    ],
    format: "iife",
    minify: true,
    naming: "harness.js",
    outdir: buildDirectory,
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  harness = await Bun.file(join(buildDirectory, "harness.js")).text();
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  if (buildDirectory) {
    await rm(buildDirectory, { force: true, recursive: true });
  }
});

const origin = "https://workspace.example.test";
// Long enough for several reads at the browser poll interval.
const config = {
  baseUrl: origin,
  timeouts: { ...workspaceE2ETimeouts, uiTransition: 3000 },
};
const caseId = "referral-cookie";
// Covers opening the page and both 15-second steps.
const caseWatchdogMs = 35_000;
// A watchdog that fires interrupts the case, whose Scope then waits up to one
// browser action for the session to close. Under load that sum overruns the
// suite's 30-second per-test default, so each test allows for both.
const testTimeoutMs =
  caseWatchdogMs + workspaceE2ETimeouts.browserAction + 5000;
const stepId = "referral-cookie-step";
const sharedCode = "RFLSYNTHETICSHARED";
const otherCode = "RFLSYNTHETICOTHER";

/**
 * Opens a session on the account page, the shared link's landing page, with
 * the app's referral component mounted, and returns once the harness reports.
 */
const openAccountPage = (search: string) =>
  Effect.gen(function* () {
    if (!browser) return yield* Effect.die("Chromium is not running");
    const session = yield* E2EBrowserSession.open({
      browser,
      id: `referral-cookie-test-${randomUUID()}`,
      recordHar: false,
    });
    yield* session.use("open the account page", async (page) => {
      await page.context().route(`${origin}/**`, (route) => {
        const { pathname } = new URL(route.request().url());
        if (pathname === "/harness.js")
          return route.fulfill({
            body: harness,
            contentType: "text/javascript",
          });
        if (pathname === "/evidence") return route.fulfill({ status: 204 });
        return route.fulfill({
          body: `<!doctype html><html><body><div id="root"></div><script src="/harness.js"></script></body></html>`,
          contentType: "text/html; charset=utf-8",
        });
      });
      const reported = page.waitForRequest(`${origin}/evidence`);
      await page.goto(`${origin}/en-US/account${search}`);
      await reported;
    });
    return session;
  });

type CookieWaitContext = Parameters<typeof waitForNoRememberedReferralCode>[0];

/**
 * Opens the account page at `search`, runs `precondition` as a step of its
 * own, then runs `wait` as the step under test through the case runner.
 * Returns the annotation as the reporter would see it, each failure of the
 * step under test with its operation and timeout class, whether the case
 * succeeded, and all reported text.
 */
const runCookieStep = async ({
  precondition,
  search,
  wait,
}: {
  readonly precondition?: (
    context: CookieWaitContext
  ) => Effect.Effect<void, WorkspaceE2EError>;
  readonly search: string;
  readonly wait: (
    context: CookieWaitContext
  ) => Effect.Effect<void, WorkspaceE2EError>;
}) => {
  const observations: E2ETelemetryObservation[] = [];
  const failures: WorkspaceE2EError[] = [];
  const exit = await Effect.runPromiseExit(
    runE2ECase({
      body: (step) =>
        Effect.scoped(
          Effect.gen(function* () {
            const session = yield* openAccountPage(search);
            const context = { config, session };
            if (precondition)
              yield* step({
                execute: precondition(context),
                id: "referral-cookie-precondition",
                timeoutMs: 15_000,
              });
            yield* step({
              execute: wait(context).pipe(
                Effect.tapError((failure) =>
                  Effect.sync(() => failures.push(failure))
                )
              ),
              id: stepId,
              timeoutMs: 15_000,
            });
          })
        ),
      caseId,
      watchdogMs: caseWatchdogMs,
    }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
  );
  const annotations = observations
    .filter(({ scope }) => scope === "annotation")
    .map(({ scope: _scope, ...annotation }) => annotation);
  return {
    annotations,
    failures: failures.map((failure) => ({
      operation: failure.operation,
      timeout: isWorkspaceE2ETimeout(failure),
    })),
    succeeded: Exit.isSuccess(exit),
    reported: JSON.stringify({
      annotations,
      messages: failures.map(({ message }) => message),
    }),
  };
};

const passed = { annotations: [], failures: [], succeeded: true };
const timedOut = (operation: string) => ({
  annotations: [
    { caseId, failureKind: "timeout", outcome: "timed_out", stepId } as const,
  ],
  failures: [{ operation, timeout: true }],
  succeeded: false,
});
const rememberSharedCode = (context: CookieWaitContext) =>
  waitForRememberedReferralCode(context, sharedCode);

test.skipIf(!chromiumAvailable)(
  "accepts the shared code the shown page remembered",
  async () => {
    const { reported: _reported, ...result } = await runCookieStep({
      search: `?ref=${sharedCode}`,
      wait: rememberSharedCode,
    });

    expect(result).toEqual(passed);
  },
  testTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "finds no remembered code in a fresh context",
  async () => {
    const { reported: _reported, ...result } = await runCookieStep({
      search: "",
      wait: waitForNoRememberedReferralCode,
    });

    expect(result).toEqual(passed);
  },
  testTimeoutMs
);

// The timeouts below first wait, as a step of their own, until the shared
// code is remembered, so they time out on the cookie the app wrote.
test.skipIf(!chromiumAvailable)(
  "times out on another remembered code without reporting either code",
  async () => {
    const { reported, ...result } = await runCookieStep({
      precondition: rememberSharedCode,
      search: `?ref=${sharedCode}`,
      wait: (context) => waitForRememberedReferralCode(context, otherCode),
    });

    expect(result).toEqual(timedOut("remembered referral code cookie"));
    expect(reported).not.toContain(sharedCode);
    expect(reported).not.toContain(otherCode);
  },
  testTimeoutMs
);

test.skipIf(!chromiumAvailable)(
  "times out while a code is remembered without reporting it",
  async () => {
    const { reported, ...result } = await runCookieStep({
      precondition: rememberSharedCode,
      search: `?ref=${sharedCode}`,
      wait: waitForNoRememberedReferralCode,
    });

    expect(result).toEqual(timedOut("no remembered referral code cookie"));
    expect(reported).not.toContain(sharedCode);
  },
  testTimeoutMs
);
