import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium } from "@playwright/test";
import { Effect } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import {
  failedStepAnnotation,
  runBrowserStep,
} from "../case-runner.browser.test-utils";
import {
  type HostedScenario,
  hostedPaymentServer,
  prepareHostedPayment,
} from "./nexi-hosted-payment.browser.test-utils";

const chromiumAvailable = await playwrightChromiumAvailable();
const browserTest = test.skipIf(!chromiumAvailable);
let browser: Browser | undefined;
beforeAll(async () => {
  if (chromiumAvailable) browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  hostedPaymentServer.stop(true);
});

const exercise = async (
  id: string,
  scenario: HostedScenario = {},
  options: Parameters<
    ReturnType<typeof prepareHostedPayment>["payment"]
  >[1] = {},
  stepTimeoutMs = 40_000,
  afterStep?: Parameters<typeof runBrowserStep>[0]["afterStep"]
) => {
  if (!browser) throw new Error("Chromium is not running");
  const fixture = prepareHostedPayment(id, scenario);
  const startedAt = Date.now();
  try {
    const result = await runBrowserStep({
      afterStep,
      browser,
      drive: (driver) => fixture.payment(driver, options),
      prepare: fixture.prepare,
      stepTimeoutMs,
    });
    return {
      ...result,
      state: fixture.state,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    fixture.restore();
  }
};

type Result = Awaited<ReturnType<typeof exercise>>;
const expectSuccess = (result: Result) => {
  expect(result.succeeded).toBe(true);
  expect(result.annotations).toEqual([]);
  expect(result.failures).toEqual([]);
  expect(result.steps).toContainEqual(
    expect.objectContaining({ outcome: "passed", stepId: "drive-browser-step" })
  );
};
const expectFailure = (
  result: Result,
  diagnosticCode?: string,
  timeout = false,
  failureSource: "operation" | "step" = "operation"
) => {
  expect(result.succeeded).toBe(false);
  expect(result.annotations).toEqual(
    failedStepAnnotation(timeout ? "timeout" : "error").map((annotation) => ({
      ...annotation,
      ...(diagnosticCode ? { diagnosticCode } : {}),
    }))
  );
  expect(result.steps).toContainEqual(
    expect.objectContaining({
      failureKind: timeout ? "timeout" : "error",
      outcome: timeout ? "timed_out" : "failed",
    })
  );
  expect(result.failures.map(({ timeout }) => timeout)).toEqual(
    failureSource === "step" ? [] : [timeout]
  );
};
const actions = ["continue", "pay", "challenge", "return"];

browserTest(
  "fills each card field iframe and returns in the same tab exactly once",
  async () => {
    const result = await exercise("iframe-fields");
    expectSuccess(result);
    expect([...result.state.fields.keys()].sort()).toEqual([
      "card_number",
      "cardholder_email",
      "cardholder_name",
      "expiration_date",
      "security_code",
    ]);
    expect(
      [...result.state.fields.values()].every(
        ({ nonempty, correct }) => nonempty && correct
      )
    ).toBe(true);
    expect(result.state.actions).toEqual(actions);
  },
  60_000
);

browserTest(
  "types into a hosted field when fill does not stick",
  async () => {
    const result = await exercise("fallback", { fallback: true });
    expectSuccess(result);
    expect(result.state.fields.get("card_number")).toEqual({
      nonempty: true,
      typed: true,
      correct: true,
    });
    expect(result.state.actions).toEqual(actions);
  },
  60_000
);

browserTest(
  "fails fast after a real rejected card-data response",
  async () => {
    const result = await exercise("rejection", { continueOutcome: "reject" });
    expectFailure(result, "nexi_hosted_continue_card_submission_rejected");
    expect(result.state.actions).toEqual(["continue"]);
    expect(result.elapsedMs).toBeLessThan(15_000);
  },
  60_000
);

browserTest(
  "baselines earlier card-data rejections",
  async () => {
    const result = await exercise("baseline", { rejectionBaseline: true });
    expectSuccess(result);
    expect(result.state.actions).toEqual(actions);
  },
  60_000
);

for (const outcome of ["error", "failure"] as const) {
  browserTest(
    `fails fast on the provider ${outcome} page`,
    async () => {
      const result = await exercise(`provider-${outcome}`, {
        continueOutcome: outcome,
      });
      expectFailure(result, `nexi_hosted_continue_provider_${outcome}_page`);
      expect(result.state.actions).toEqual(["continue"]);
    },
    60_000
  );
}

browserTest(
  "chooses failed authentication and returns from its payment error page",
  async () => {
    const result = await exercise(
      "failed-challenge",
      {},
      { challengeOutcome: "failed" }
    );
    expectSuccess(result);
    expect(result.state.actions).toEqual([
      "continue",
      "pay",
      "challenge_failure",
      "return",
    ]);
  },
  60_000
);

browserTest(
  "rejects an error page before failed authentication was chosen",
  async () => {
    const result = await exercise(
      "premature-error",
      { continueOutcome: "error" },
      { challengeOutcome: "failed" }
    );
    expectFailure(result, "nexi_hosted_continue_provider_error_page");
    expect(result.state.actions).toEqual(["continue"]);
  },
  60_000
);

browserTest(
  "annotates a stalled transition as a timeout with its last page state",
  async () => {
    const result = await exercise(
      "stall",
      { continueOutcome: "stall" },
      { providerTransition: 2500 }
    );
    expectFailure(result, "nexi_hosted_continue_card_entry_ready", true);
    expect(result.state.actions).toEqual(["continue"]);
  },
  60_000
);

browserTest(
  "crosses an empty snapshot document and accepts a direct provider return",
  async () => {
    const result = await exercise("snapshot-gap", {
      snapshotGap: true,
      directReturn: true,
    });
    expectSuccess(result);
    expect(result.state.gaps).toBe(1);
    expect(result.state.actions).toEqual(["continue", "pay", "challenge"]);
  },
  60_000
);

browserTest(
  "accepts a return activation that navigates and then rejects",
  async () => {
    const result = await exercise("return-reject-navigation", {
      returnActivation: "navigate-and-reject",
    });
    expectSuccess(result);
    expect(result.state.actions).toEqual(actions);
  },
  60_000
);

browserTest(
  "fails a rejected return activation without a return or a second activation",
  async () => {
    const result = await exercise("return-reject", {
      returnActivation: "reject",
    });
    expectFailure(result);
    expect(result.state.actions).toEqual(actions);
  },
  60_000
);

browserTest(
  "calls the authorization callback once immediately before Pay",
  async () => {
    let calls = 0;
    const result = await exercise(
      "authorization",
      {},
      {
        onPaymentAuthorizationRequested: () => {
          calls += 1;
        },
      }
    );
    expectSuccess(result);
    expect(calls).toBe(1);
    expect(result.state.authorizationActions).toEqual([["continue"]]);
    expect(result.state.actions).toEqual(actions);
  },
  60_000
);

browserTest(
  "a callback error stops authorization and annotates a defect",
  async () => {
    let calls = 0;
    const result = await exercise(
      "authorization-error",
      {},
      {
        onPaymentAuthorizationRequested: () => {
          calls += 1;
          throw new Error("Synthetic callback error");
        },
      }
    );
    expect(result.succeeded).toBe(false);
    expect(result.annotations).toEqual([
      {
        caseId: "browser-step",
        stepId: "drive-browser-step",
        outcome: "failed",
        failureKind: "defect",
      },
    ]);
    expect(result.steps).toContainEqual(
      expect.objectContaining({ outcome: "failed", failureKind: "defect" })
    );
    expect(result.failures).toEqual([]);
    expect(calls).toBe(1);
    expect(result.state.authorizationActions).toEqual([["continue"]]);
    expect(result.state.actions).toEqual(["continue"]);
  },
  60_000
);

browserTest(
  "a step cancellation prevents any later challenge action",
  async () => {
    let calls = 0;
    const result = await exercise(
      "cancellation",
      { disabledChallenge: true },
      {
        onPaymentAuthorizationRequested: () => {
          calls += 1;
        },
      },
      5000,
      ({ session }) =>
        Effect.andThen(
          session.use("enable challenge after cancellation", (page) =>
            page.locator("button").evaluateAll((buttons) => {
              for (const button of buttons) button.removeAttribute("disabled");
            })
          ),
          Effect.sleep(1500)
        )
    );
    expectFailure(result, undefined, true, "step");
    expect(calls).toBe(1);
    expect(result.state.authorizationActions).toEqual([["continue"]]);
    expect(result.state.actions).toEqual(["continue", "pay"]);
  },
  60_000
);

browserTest(
  "waits for the returned popup to close and reactivates checkout",
  async () => {
    let remaining = 0;
    const result = await exercise(
      "popup",
      { popup: true },
      {},
      40_000,
      ({ session }) =>
        session.use("inspect returned checkout", async (page) => {
          remaining = page.context().pages().length;
          expect(new URL(page.url()).pathname).toStartWith(
            "/reservation/status/"
          );
        })
    );
    expectSuccess(result);
    expect(remaining).toBe(1);
    expect(result.state.actions).toEqual(actions);
  },
  60_000
);

browserTest(
  "bounds the wait for a returned popup that never closes",
  async () => {
    const result = await exercise(
      "popup-open",
      { popup: true, keepPopup: true },
      { providerTransition: 2500 }
    );
    expectFailure(result, undefined, true);
    expect(result.state.actions).toEqual(actions);
  },
  60_000
);
