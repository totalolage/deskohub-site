import { afterAll, beforeAll, expect, test } from "bun:test";
import { AssertionError } from "node:assert";
import { randomUUID } from "node:crypto";
import { type Browser, chromium, errors, type Page } from "@playwright/test";
import { Cause, Effect, Exit, Option } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { verifyReferralScreenIgnoresShareLink } from "../account/referral-review";
import type { E2EBrowserSession } from "../browser-session";
import { runE2ECase } from "../case-runner";
import {
  type BrowserStepDriver,
  failedStepAnnotation,
  runBrowserStep,
} from "../case-runner.browser.test-utils";
import {
  type WorkspaceE2EError,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "../errors";
import {
  assert,
  browserSessionFor,
  makePlaywrightBrowserRunner,
} from "../runtime";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "../services/telemetry.mock";
import {
  captureReferralCheckoutOnCasePage,
  onReferralCasePage,
} from "./case-page";
import { captureReviewStep } from "./checkout";

// A referral case's page steps and pay-page review capture, driven through
// the browser session on a real Chromium: how the case runner classifies
// their failures, and that they drive only a browser holding the case's page
// alone.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

const origin = "https://workspace.example.test";

const showPage = (html: string) => (session: E2EBrowserSession) =>
  session.use("show the page", (page) => page.setContent(html));

const runPageStep = <A>(
  html: string,
  drive: (driver: BrowserStepDriver) => Effect.Effect<A, WorkspaceE2EError>,
  options: Omit<
    Parameters<typeof runBrowserStep>[0],
    "browser" | "drive" | "prepare"
  > = {}
) => {
  assert(browser, "Chromium is not running");
  return runBrowserStep({
    ...options,
    browser,
    drive,
    prepare: showPage(html),
  });
};

test.skipIf(!chromiumAvailable)(
  "returns what a page step drives on the case's only page",
  async () => {
    const result = await runPageStep(`<p id="state">ready</p>`, ({ session }) =>
      onReferralCasePage(session, "read-state", (page) =>
        page.locator("#state").innerText()
      )
    );

    expect(result.annotations).toEqual([]);
    expect(result.value).toBe("ready");
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "fails a page step on a Playwright timeout, an assertion or a page check, never times it out",
  async () => {
    const drives: readonly ((page: Page) => Promise<unknown>)[] = [
      (page) => page.locator("#missing").click({ timeout: 300 }),
      async () => {
        // The React click-handler wait gives up with Playwright's timeout.
        throw new errors.TimeoutError("React click handler wait timed out");
      },
      async () => assert(false, "the savings tile is missing"),
      async () => {
        throw new Error("unexpected page state");
      },
    ];
    for (const drive of drives) {
      const result = await runPageStep("<main></main>", ({ session }) =>
        onReferralCasePage(session, "drive-referral-page", drive)
      );

      expect(result.annotations).toEqual(failedStepAnnotation("error"));
      expect(result.failures).toEqual([
        { message: "drive-referral-page failed", timeout: false },
      ]);
    }
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "keeps a callback's own Workspace E2E failure as the cause of the step failure",
  async () => {
    const outcomes = [];
    for (const [thrown, failureKind] of [
      [
        workspaceE2EError("fixture cleanup did not converge", {
          diagnosticCode: "postgres_account_fixture_convergence_failed",
        }),
        "error",
      ],
      [workspaceE2ETimeoutError("provider profile read timed out"), "timeout"],
      [new AssertionError({ message: "the savings tile is missing" }), "error"],
    ] as const) {
      const result = await runPageStep("<main></main>", ({ session }) =>
        onReferralCasePage(session, "drive-referral-page", async () => {
          throw thrown;
        })
      );
      outcomes.push({
        annotations: result.annotations,
        expected: failedStepAnnotation(failureKind),
        messages: result.failures.map(({ message }) => message),
      });
    }

    // As the referral page steps before the session: the step fails with
    // its own message, the callback's code never reaches the annotation,
    // and a timeout it raised still times the step out.
    for (const { annotations, expected, messages } of outcomes) {
      expect(annotations).toEqual(expected);
      expect(messages).toEqual(["drive-referral-page failed"]);
    }
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "fails a page step whose referral screen check fails, without a diagnostic code",
  async () => {
    const shareCode = "RFLSYNTHETICSHARE";
    const result = await runPageStep("<main></main>", ({ session }) =>
      Effect.andThen(
        session.use("serve the referrals screen", (page) =>
          page.context().route(`${origin}/**`, (route) =>
            route.fulfill({
              // The screen shows the share link's code as its own.
              body: `<section data-screen="referrals-screen">
                    <span id="account-referrals-code">${shareCode}</span>
                  </section>`,
              contentType: "text/html; charset=utf-8",
            })
          )
        ),
        onReferralCasePage(session, "verify-referral-screen", (page) =>
          verifyReferralScreenIgnoresShareLink({
            baseUrl: origin,
            page,
            shareCode,
          })
        )
      )
    );

    expect(result.annotations).toEqual(failedStepAnnotation("error"));
    expect(result.failures.map(({ timeout }) => timeout)).toEqual([false]);
    expect(JSON.stringify(result.failures)).not.toContain(shareCode);
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "fails a page step unless the browser holds the case's page alone",
  async () => {
    const secondPage = await runPageStep("<main></main>", ({ session }) =>
      Effect.andThen(
        session.use("open another page", (page) => page.context().newPage()),
        onReferralCasePage(session, "drive-referral-page", async () => "driven")
      )
    );
    expect(secondPage.annotations).toEqual(failedStepAnnotation("error"));
    expect(secondPage.value).toBeUndefined();

    assert(browser, "Chromium is not running");
    const otherContext = await browser.newContext();
    try {
      await otherContext.newPage();
      const secondContext = await runPageStep("<main></main>", ({ session }) =>
        onReferralCasePage(session, "drive-referral-page", async () => "driven")
      );
      expect(secondContext.annotations).toEqual(failedStepAnnotation("error"));
      expect(secondContext.value).toBeUndefined();
    } finally {
      await otherContext.close();
    }
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "times out a page step that outlives its step deadline",
  async () => {
    const result = await runPageStep(
      "<main></main>",
      ({ session }) =>
        onReferralCasePage(session, "drive-referral-page", (page) =>
          page.waitForFunction(() => false, undefined, { timeout: 10_000 })
        ),
      { stepTimeoutMs: 500 }
    );

    expect(result.annotations).toEqual(failedStepAnnotation("timeout"));
  },
  60_000
);

const orderId = "workspace-reservation-123" as WorkspaceReservationId;
const payUrl = `${origin}/en-US/checkout/pay?payState=initial&orderId=${orderId}`;
const captureCaseId = "referral-capture";
const captureStepId = "capture-invitation-applied";

/**
 * Runs the case's review capture step of the invitation-applied pay page
 * through the C03 runner on a real Chromium, after `prepare` has set the
 * session's page up. Reports the case annotations and the step's failure.
 */
const runCaptureStep = async ({
  prepare,
  screenshots,
}: {
  readonly prepare: (
    session: E2EBrowserSession
  ) => Effect.Effect<void, WorkspaceE2EError>;
  readonly screenshots: boolean;
}) => {
  assert(browser, "Chromium is not running");
  const run = makePlaywrightBrowserRunner(browser, { recordHar: false });
  const id = `referral-capture-${randomUUID()}`;
  const observations: E2ETelemetryObservation[] = [];
  try {
    const exit = await Effect.runPromiseExit(
      runE2ECase({
        body: (step) =>
          Effect.gen(function* () {
            const session = yield* browserSessionFor(run, id);
            yield* prepare(session);
            yield* captureReviewStep({
              captureReview: captureReferralCheckoutOnCasePage(session, {
                baseUrl: origin,
                screenshots,
              }),
              expectedPayUrl: payUrl,
              orderId,
              runStep: step,
              target: "account-referral-invitation-applied",
            });
          }),
        caseId: captureCaseId,
        watchdogMs: 60_000,
      }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
    );
    const failure = Exit.isFailure(exit)
      ? Cause.findErrorOption(exit.cause).pipe(Option.getOrUndefined)
      : undefined;
    return {
      annotations: observations
        .filter(({ scope }) => scope === "annotation")
        .map(({ scope: _scope, ...annotation }) => annotation),
      failure: failure && {
        message: failure.message,
        operation: failure.operation,
      },
    };
  } finally {
    await run.close?.();
  }
};

const failedCapture = {
  annotations: [
    {
      caseId: captureCaseId,
      failureKind: "error" as const,
      outcome: "failed" as const,
      stepId: captureStepId,
    },
  ],
  failure: {
    message: "referral checkout review capture failed",
    operation: "capture account referral checkout review",
  },
};

test.skipIf(!chromiumAvailable)(
  "skips the review capture without screenshots on the case's only page",
  async () => {
    const result = await runCaptureStep({
      prepare: showPage("<main></main>"),
      screenshots: false,
    });

    expect(result).toEqual({ annotations: [], failure: undefined });
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "fails the review capture plainly outside the owned pay page or beside another page",
  async () => {
    // The page is not the owned pay page, so the capture refuses it before
    // it writes anything.
    const elsewhere = await runCaptureStep({
      prepare: showPage("<main></main>"),
      screenshots: true,
    });
    expect(elsewhere).toEqual(failedCapture);

    const besideAnotherPage = await runCaptureStep({
      prepare: (session) =>
        session
          .use("open another page", (page) => page.context().newPage())
          .pipe(Effect.asVoid),
      screenshots: false,
    });
    expect(besideAnotherPage).toEqual(failedCapture);
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "fails the review capture plainly when the pay page's discounts never show",
  async () => {
    const result = await runCaptureStep({
      // The owned pay page without its discount details, and a short default
      // timeout, so the capture's wait for them times out before any
      // screenshot.
      prepare: (session) =>
        session.use("show the owned pay page", async (page) => {
          await page.context().route(`${origin}/**`, (route) =>
            route.fulfill({
              body: "<main></main>",
              contentType: "text/html; charset=utf-8",
            })
          );
          await page.goto(payUrl);
          page.setDefaultTimeout(300);
        }),
      screenshots: true,
    });

    expect(result).toEqual(failedCapture);
  },
  60_000
);
