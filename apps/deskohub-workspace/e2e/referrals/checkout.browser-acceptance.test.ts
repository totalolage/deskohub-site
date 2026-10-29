import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { type Browser, chromium } from "@playwright/test";
import { Cause, Effect, Exit, Layer, type Scope } from "effect";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import { formatReferralInvitationDiscount } from "@/features/referrals/client";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { formatMoney, type Money } from "@/shared/money/money";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { createCensoredOtelSpanExporter } from "../../shared/backend/logging/censorship";
import { createTracingLive } from "../../shared/backend/observability/otel-tracing";
import { E2EBrowserSession } from "../browser-session";
import { runE2ECase, type WorkspaceE2EStepRunner } from "../case-runner";
import type { WorkspaceE2EConfig } from "../config";
import { makeTestE2EEnvironment } from "../e2e-env.test-fixture";
import { isWorkspaceE2ETimeout, type WorkspaceE2EError } from "../errors";
import { browserSessionFor, makePlaywrightBrowserRunner } from "../runtime";
import {
  E2ERunContextService,
  E2ETelemetryService,
  type WorkspaceE2EFailureDiagnostic,
} from "../services/telemetry";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  applyCodeAndReadFreshPayUrl,
  assertOrdinaryCodeSlotAvailable,
  assertReferralConfirmationCleared,
  assertReferrerDiscountMatchesRemainingSubtotal,
  assertShareLinkReferralApplied,
  calculateSingleInviteeReferralDiscount,
  referralAppliedMessage,
  referralVoucherAdjustment,
  rejectReferralCode,
} from "./checkout";

// The referral checkout assertions drive the browser session; these pin what
// they accept, how the case runner classifies their failures, and what the
// ordinary-code observation exports, against a real Chromium.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

const locale = "en-US";
const origin = "https://workspace.example.test";
const orderId = "workspace-reservation-123" as WorkspaceReservationId;
const payUrl = `${origin}/${locale}/checkout/pay?payState=initial&orderId=${orderId}`;
const config = {
  baseUrl: origin,
  timeouts: {
    ...workspaceE2ETimeouts,
    browserAction: 5000,
    uiTransition: 2000,
  },
} as WorkspaceE2EConfig;
const caseId = "referral-checkout";
const stepId = "referral-checkout-step";
const ordinaryCodeSlotObservationKey =
  "__deskohubE2EReferralDiscountFormObservation";

/** Serves the synthetic checkout: the HTML body for a URL, or 404. */
type CheckoutPages = (url: URL) => string | undefined;

const showCheckout = (session: E2EBrowserSession, pages: CheckoutPages) =>
  session.use("open the synthetic checkout", async (page) => {
    await page.context().route(`${origin}/**`, (route) => {
      const body = pages(new URL(route.request().url()));
      return body === undefined
        ? route.fulfill({ status: 404 })
        : route.fulfill({
            body: `<!doctype html><html lang="${locale}"><body>${body}</body></html>`,
            contentType: "text/html; charset=utf-8",
          });
    });
    await page.goto(payUrl);
  });

/** A session of its own, showing `pages` at the pay URL. */
const openCheckout = (pages: CheckoutPages) =>
  Effect.gen(function* () {
    if (!browser) return yield* Effect.die("Chromium is not running");
    const session = yield* E2EBrowserSession.open({
      browser,
      id: `referral-checkout-test-${randomUUID()}`,
      recordHar: false,
    });
    yield* showCheckout(session, pages);
    return session;
  });

/**
 * Sets the checkout up, then runs `execute` on it as one step through the case
 * runner under real tracing, so the step's deadline covers only the helper.
 * Returns the case's annotations as the reporter would see them, the step's
 * failures, and the exported spans.
 */
/** Runs a helper's own step inline, inside the harness step. */
const inlineStep: WorkspaceE2EStepRunner = ({ execute }) => execute;

const runCheckoutStep = async <S>(
  setup: Effect.Effect<S, WorkspaceE2EError, Scope.Scope>,
  execute: (
    checkout: S,
    runStep: WorkspaceE2EStepRunner
  ) => Effect.Effect<unknown, WorkspaceE2EError>,
  {
    ownStep = false,
    stepTimeoutMs = 15_000,
  }: {
    /** `execute` runs its own step through the case runner's `runStep`. */
    readonly ownStep?: boolean;
    readonly stepTimeoutMs?: number;
  } = {}
) => {
  const annotations: WorkspaceE2EFailureDiagnostic[] = [];
  const failures: WorkspaceE2EError[] = [];
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [
      new SimpleSpanProcessor(createCensoredOtelSpanExporter(exporter)),
    ],
  });
  const telemetryLayer = Layer.effect(
    E2ETelemetryService,
    Effect.gen(function* () {
      const telemetry = yield* E2ETelemetryService;
      return {
        ...telemetry,
        annotateFailure: (diagnostic: WorkspaceE2EFailureDiagnostic) =>
          Effect.sync(() => {
            annotations.push(diagnostic);
          }),
      };
    })
  ).pipe(
    Layer.provide(E2ETelemetryService.Default),
    Layer.provide(E2ERunContextService.layer(makeTestE2EEnvironment()))
  );
  const layer = Layer.merge(
    createTracingLive({
      provider,
      serviceName: "deskohub-workspace-referral-checkout-test",
    }),
    telemetryLayer
  );
  try {
    const exit = await Effect.runPromiseExit(
      runE2ECase({
        body: (step) =>
          Effect.scoped(
            Effect.flatMap(setup, (checkout) => {
              const recorded = (runStep: WorkspaceE2EStepRunner) =>
                execute(checkout, runStep).pipe(
                  Effect.tapError((failure) =>
                    Effect.sync(() => failures.push(failure))
                  ),
                  Effect.asVoid
                );
              return ownStep
                ? recorded(step)
                : step({
                    execute: recorded(inlineStep),
                    id: stepId,
                    timeoutMs: stepTimeoutMs,
                  });
            })
          ),
        caseId,
        watchdogMs: stepTimeoutMs + 15_000,
      }).pipe(Effect.provide(layer))
    );
    await provider.forceFlush();
    const stepSpan = exporter
      .getFinishedSpans()
      .find(
        (span) =>
          span.name === "e2e.step" && span.attributes["e2e.step.id"] === stepId
      );
    return {
      annotations,
      exit,
      failures,
      spans: exporter.getFinishedSpans(),
      stepAttributes: stepSpan?.attributes ?? {},
    };
  } finally {
    await provider.shutdown();
  }
};

const passed = { annotations: [], failures: [], succeeded: true };
const timedOutAnnotation = {
  caseId,
  failureKind: "timeout",
  outcome: "timed_out",
  stepId,
} as const;
const timedOut = (operation: string) => ({
  annotations: [timedOutAnnotation],
  failures: [{ operation, timeout: true }],
  succeeded: false,
});
const failed = (operation: string) => ({
  annotations: [
    { caseId, failureKind: "error", outcome: "failed", stepId } as const,
  ],
  failures: [{ operation, timeout: false }],
  succeeded: false,
});

/**
 * The C03 annotation, each failure's operation and timeout class, and whether
 * the case succeeded.
 */
const classify = ({
  annotations,
  exit,
  failures,
}: Awaited<ReturnType<typeof runCheckoutStep>>) => ({
  annotations,
  failures: failures.map((failure) => ({
    operation: failure.operation,
    timeout: isWorkspaceE2ETimeout(failure),
  })),
  succeeded: Exit.isSuccess(exit),
});

const ordinaryCodeForm = ({
  inputValue = "",
  visible = true,
}: {
  readonly inputValue?: string;
  readonly visible?: boolean;
} = {}) =>
  `<form id="checkout-discount-code-form"${visible ? "" : ' style="display:none"'}>
    <input id="checkout-discount-code" name="submittedCode" value="${Bun.escapeHTML(inputValue)}">
    <button type="submit">Apply</button>
  </form>`;

const discountFormAttributes = (attributes: Record<string, unknown>) =>
  Object.keys(attributes).filter((key) =>
    key.startsWith("e2e.account.discount_form.")
  );

test.skipIf(!chromiumAvailable)(
  "exports the ordinary-code form state of a slot that is free",
  async () => {
    const result = await runCheckoutStep(
      openCheckout(() => ordinaryCodeForm()),
      (session) => assertOrdinaryCodeSlotAvailable({ config, session })
    );

    expect(classify(result)).toEqual(passed);
    expect(result.stepAttributes).toMatchObject({
      "e2e.account.discount_form.form_count": 1,
      "e2e.account.discount_form.named_field_count": 1,
      "e2e.account.discount_form.selected_form_present": 1,
      "e2e.account.discount_form.selected_form_visible": 1,
      "e2e.account.discount_form.named_input_present": 1,
      "e2e.account.discount_form.named_input_enabled": 1,
      "e2e.account.discount_form.named_input_empty": 1,
      "e2e.account.discount_form.submit_present": 1,
      "e2e.account.discount_form.submit_enabled": 1,
    });
  }
);

// A hidden first form holding a typed code, then eleven more forms: the
// counts are capped and no typed or page value may reach a span.
const takenSlot = `${ordinaryCodeForm({ inputValue: "SYNTHETIC-PRIVATE-CODE", visible: false })}
  ${Array.from({ length: 10 }, () => ordinaryCodeForm()).join("")}
  <form id="checkout-discount-code-form"></form>
  <p hidden data-ref="RFL12345"></p>`;
const takenSlotAttributes = {
  "e2e.account.discount_form.form_count": 9,
  "e2e.account.discount_form.named_field_count": 9,
  "e2e.account.discount_form.selected_form_present": 1,
  "e2e.account.discount_form.selected_form_visible": 0,
  "e2e.account.discount_form.named_input_present": 1,
  "e2e.account.discount_form.named_input_enabled": 1,
  "e2e.account.discount_form.named_input_empty": 0,
  "e2e.account.discount_form.submit_present": 1,
  "e2e.account.discount_form.submit_enabled": 1,
};
const takenSlotPrivateValues = [
  "SYNTHETIC-PRIVATE-CODE",
  "submittedCode",
  "workspace.example.test",
  "payState=initial",
  "RFL12345",
];
// The wait can still record its observation; reading it back throws.
const unreadableObservation = `${ordinaryCodeForm({ inputValue: "SYNTHETIC-PRIVATE-CODE" })}
  <script>
    Object.defineProperty(window, ${JSON.stringify(ordinaryCodeSlotObservationKey)}, {
      configurable: true,
      get() { throw new Error("SYNTHETIC-PRIVATE-OBSERVER-FAILURE"); },
      set() {},
    });
  </script>`;
const slowConfig = {
  ...config,
  timeouts: { ...config.timeouts, uiTransition: 30_000 },
} as WorkspaceE2EConfig;

const assertSlot = (
  body: string,
  options: {
    readonly config?: WorkspaceE2EConfig;
    readonly stepTimeoutMs?: number;
  } = {}
) =>
  runCheckoutStep(
    openCheckout(() => body),
    (session) =>
      assertOrdinaryCodeSlotAvailable({
        config: options.config ?? config,
        session,
      }),
    options
  );

/** The step's own deadline ended it: a timeout no step failure reported. */
const expectStepDeadline = (result: Awaited<ReturnType<typeof assertSlot>>) => {
  expect(classify(result)).toEqual({
    annotations: [timedOutAnnotation],
    failures: [],
    succeeded: false,
  });
  expect(
    Exit.isFailure(result.exit) &&
      isWorkspaceE2ETimeout(Cause.squash(result.exit.cause))
  ).toBe(true);
  expect(result.stepAttributes).toMatchObject({
    "e2e.failure.kind": "timeout",
    "e2e.outcome": "timed_out",
  });
};

test.skipIf(!chromiumAvailable)(
  "times out on a taken slot and exports only its bounded form state",
  async () => {
    const result = await assertSlot(takenSlot);

    expect(classify(result)).toEqual(
      timedOut("wait for ordinary code slot after referral acceptance")
    );
    expect(result.stepAttributes).toMatchObject({
      "e2e.failure.kind": "timeout",
      "e2e.outcome": "timed_out",
      ...takenSlotAttributes,
    });
    const exported = JSON.stringify(result.spans);
    for (const privateValue of takenSlotPrivateValues) {
      expect(exported).not.toContain(privateValue);
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "exports the taken slot's form state when the step deadline interrupts the wait",
  async () => {
    const result = await assertSlot(takenSlot, {
      config: slowConfig,
      stepTimeoutMs: 2000,
    });

    expectStepDeadline(result);
    expect(result.stepAttributes).toMatchObject(takenSlotAttributes);
    const exported = JSON.stringify(result.spans);
    for (const privateValue of takenSlotPrivateValues) {
      expect(exported).not.toContain(privateValue);
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "keeps the slot timeout when the observation read fails",
  async () => {
    const result = await assertSlot(unreadableObservation);

    expect(classify(result)).toEqual(
      timedOut("wait for ordinary code slot after referral acceptance")
    );
    expect(result.stepAttributes).toMatchObject({
      "e2e.failure.kind": "timeout",
      "e2e.outcome": "timed_out",
    });
    expect(discountFormAttributes(result.stepAttributes)).toEqual([]);
    const exported = JSON.stringify(result.spans);
    expect(exported).not.toContain("SYNTHETIC-PRIVATE-OBSERVER-FAILURE");
    expect(exported).not.toContain("SYNTHETIC-PRIVATE-CODE");
  }
);

test.skipIf(!chromiumAvailable)(
  "keeps the step deadline when the observation read fails",
  async () => {
    const result = await assertSlot(unreadableObservation, {
      config: slowConfig,
      stepTimeoutMs: 2000,
    });

    expectStepDeadline(result);
    expect(discountFormAttributes(result.stepAttributes)).toEqual([]);
    expect(JSON.stringify(result.spans)).not.toContain(
      "SYNTHETIC-PRIVATE-OBSERVER-FAILURE"
    );
  }
);

const referralAppliedPayUrl = `${origin}/${locale}/checkout/pay?payState=signed&orderId=${orderId}&referralApplied=1`;
const referralAppliedNotice = `<p data-checkout-referral-applied>${Bun.escapeHTML(referralAppliedMessage(locale))}</p>`;
/** Makes the page's lookup of `selector`, and only that, throw. */
const throwingLookup = (selector: string) => `<script>
  const querySelector = document.querySelector.bind(document);
  document.querySelector = (candidate) => {
    if (candidate === ${JSON.stringify(selector)}) throw new Error("synthetic page script failure");
    return querySelector(candidate);
  };
</script>`;

const assertShareLinkNotice = (body: string) =>
  runCheckoutStep(
    openCheckout(() => body),
    (session) =>
      assertShareLinkReferralApplied({
        config,
        locale,
        orderId,
        payUrl: referralAppliedPayUrl,
        session,
      })
  );

test.skipIf(!chromiumAvailable)(
  "accepts the share-link referral notice",
  async () => {
    expect(
      classify(await assertShareLinkNotice(referralAppliedNotice))
    ).toEqual(passed);
  }
);

test.skipIf(!chromiumAvailable)(
  "times out without the share-link referral notice",
  async () => {
    expect(
      classify(
        await assertShareLinkNotice("<p data-checkout-referral-applied></p>")
      )
    ).toEqual(timedOut("wait for share-link referral applied notice"));
  }
);

test.skipIf(!chromiumAvailable)(
  "fails when the share-link notice check throws",
  async () => {
    expect(
      classify(
        await assertShareLinkNotice(
          `${referralAppliedNotice}${throwingLookup("[data-checkout-referral-applied]")}`
        )
      )
    ).toEqual(failed("wait for share-link referral applied notice"));
  }
);

const assertConfirmationCleared = (body: string) =>
  runCheckoutStep(
    openCheckout(() => body),
    (session) => assertReferralConfirmationCleared({ config, locale, session })
  );

test.skipIf(!chromiumAvailable)(
  "accepts a checkout without the referral confirmation",
  async () => {
    expect(
      classify(await assertConfirmationCleared(ordinaryCodeForm()))
    ).toEqual(passed);
  }
);

test.skipIf(!chromiumAvailable)(
  "times out while the referral confirmation is still shown",
  async () => {
    expect(
      classify(await assertConfirmationCleared(referralAppliedNotice))
    ).toEqual(
      timedOut(
        "wait for referral confirmation cleared after ordinary code application"
      )
    );
  }
);

const negative = (amount: Money): Money => ({
  ...amount,
  value: -amount.value,
});

/**
 * The discount details as the checkout summary lists them: the invitation,
 * the referrer's fixed amount on what the rows before it leave, and the
 * account voucher where `voucher` places it.
 */
const discountDetails = ({
  referrerAmountOffset = 0,
  voucher,
}: {
  readonly referrerAmountOffset?: number;
  readonly voucher: "after-referrer" | "before-referrer" | "none";
}) => {
  const original = getWorkspaceProductByTier("open-space").price;
  const invitation = {
    ...original,
    value: Math.round((original.value * 1500) / 10_000),
  };
  const voucherAmount = referralVoucherAdjustment.amount;
  const referrer = calculateSingleInviteeReferralDiscount({
    ...original,
    value:
      original.value -
      invitation.value -
      (voucher === "before-referrer" ? voucherAmount.value : 0),
  });
  const row = (label: string, adjustment: string, amount: Money) =>
    `<li><div><span>${Bun.escapeHTML(label)}</span><span>${Bun.escapeHTML(adjustment)}</span></div><span>${Bun.escapeHTML(formatMoney(amount, locale))}</span></li>`;
  const invitationRow = row(
    m.checkoutSummaryItemReferralInvitationDiscount({}, { locale }),
    formatReferralInvitationDiscount(locale),
    negative(invitation)
  );
  const referrerRow = row(
    m.checkoutSummaryItemReferralDiscount({ count: "1" }, { locale }),
    formatDiscountAdjustment({ kind: "fixed", amount: referrer }, locale),
    negative({ ...referrer, value: referrer.value + referrerAmountOffset })
  );
  const voucherRow = row(
    m.checkoutVoucherLabel({}, { locale }),
    formatDiscountAdjustment(referralVoucherAdjustment, locale),
    negative(voucherAmount)
  );
  const rows = {
    "after-referrer": [invitationRow, referrerRow, voucherRow],
    "before-referrer": [invitationRow, voucherRow, referrerRow],
    none: [invitationRow, referrerRow],
  }[voucher];
  return `<del aria-hidden="true">${Bun.escapeHTML(formatMoney(original, locale))}</del>
    <button type="button" data-checkout-discount-details aria-describedby="checkout-discount-details">Details</button>
    <div id="checkout-discount-details"><ul>${rows.join("")}</ul></div>`;
};

const assertReferrerDiscount = (
  body: string,
  requireVoucherAfterReferrer: boolean
) =>
  runCheckoutStep(
    openCheckout(() => body),
    (session) =>
      assertReferrerDiscountMatchesRemainingSubtotal({
        locale,
        requireVoucherAfterReferrer,
        session,
      })
  );

test.skipIf(!chromiumAvailable)(
  "accepts the referrer's fixed amount with the voucher after it",
  async () => {
    expect(
      classify(
        await assertReferrerDiscount(
          discountDetails({ voucher: "after-referrer" }),
          true
        )
      )
    ).toEqual(passed);
  }
);

test.skipIf(!chromiumAvailable)(
  "accepts the referrer's fixed amount without a voucher when none is required",
  async () => {
    expect(
      classify(
        await assertReferrerDiscount(
          discountDetails({ voucher: "none" }),
          false
        )
      )
    ).toEqual(passed);
  }
);

test.skipIf(!chromiumAvailable)(
  "fails a referrer deduction that differs from its fixed amount",
  async () => {
    expect(
      classify(
        await assertReferrerDiscount(
          discountDetails({
            referrerAmountOffset: 100,
            voucher: "after-referrer",
          }),
          true
        )
      )
    ).toEqual(failed("assert visible fixed referral discount"));
  }
);

test.skipIf(!chromiumAvailable)(
  "fails a voucher placed before the referrer discount only when it must follow",
  async () => {
    const page = discountDetails({ voucher: "before-referrer" });

    expect(classify(await assertReferrerDiscount(page, true))).toEqual(
      failed("assert visible fixed referral discount")
    );
    expect(classify(await assertReferrerDiscount(page, false))).toEqual(passed);
  }
);

test.skipIf(!chromiumAvailable)(
  "fails a required voucher that is missing",
  async () => {
    expect(
      classify(
        await assertReferrerDiscount(discountDetails({ voucher: "none" }), true)
      )
    ).toEqual(failed("assert visible fixed referral discount"));
  }
);

test.skipIf(!chromiumAvailable)(
  "fails when the discount amounts cannot be read",
  async () => {
    expect(
      classify(
        await assertReferrerDiscount(
          `${discountDetails({ voucher: "after-referrer" })}${throwingLookup("[data-checkout-discount-details]")}`,
          true
        )
      )
    ).toEqual(failed("read visible checkout discount amounts"));
  }
);

test.skipIf(!chromiumAvailable)(
  "leaves a stalled discount read to the step deadline, which times it out",
  async () => {
    // The read has no deadline of its own: every caller's step is shorter
    // than the argv evaluation's former bound, so the step times it out.
    const stalledRead = `<script>
      const querySelector = document.querySelector.bind(document);
      document.querySelector = (candidate) => {
        if (candidate === "[data-checkout-discount-details]") {
          const until = Date.now() + 4000;
          while (Date.now() < until) {}
        }
        return querySelector(candidate);
      };
    </script>`;

    expect(
      classify(
        await runCheckoutStep(
          openCheckout(
            () =>
              `${discountDetails({ voucher: "after-referrer" })}${stalledRead}`
          ),
          (session) =>
            assertReferrerDiscountMatchesRemainingSubtotal({
              locale,
              requireVoucherAfterReferrer: true,
              session,
            }),
          { stepTimeoutMs: 1000 }
        )
      )
    ).toEqual({
      annotations: [timedOutAnnotation],
      failures: [],
      succeeded: false,
    });
  }
);

const rejectionError = "referral-already-attributed";
const rejectedPayUrl = `${origin}/${locale}/checkout/pay?payState=rejected&orderId=${orderId}&discountCodeError=${rejectionError}`;
const rejectedCode = "RFLSYNTHETICREJECT";

/**
 * The pay page's code box carries React-like handlers and submits to a
 * re-signed pay state that reports the rejection; `invalid` marks the field.
 */
const rejectionCheckout =
  (
    message: string,
    {
      invalid,
      redirectTo = rejectedPayUrl,
    }: {
      readonly invalid: boolean;
      /** Where the submit goes; `null` keeps the pay page. */
      readonly redirectTo?: string | null;
    }
  ) =>
  (url: URL) =>
    url.searchParams.get("payState") === "rejected"
      ? `<form id="checkout-discount-code-form">
          <input id="checkout-discount-code" name="submittedCode"${invalid ? ' aria-invalid="true"' : ""}>
          <p id="checkout-discount-code-error" role="alert">${Bun.escapeHTML(message)}</p>
        </form>
        <script>
          document.getElementById("checkout-discount-code").value =
            sessionStorage.getItem("submittedCode") ?? "";
        </script>`
      : `${ordinaryCodeForm()}
        <script>
          const form = document.getElementById("checkout-discount-code-form");
          form.__reactProps$test = { onSubmit() {} };
          form.elements.submittedCode.__reactProps$test = { onChange() {} };
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            sessionStorage.setItem("submittedCode", form.elements.submittedCode.value);
            ${redirectTo === null ? "" : `location.assign(${JSON.stringify(redirectTo)});`}
          });
        </script>`;

const rejectionMessage = m.checkoutReferralCodeAlreadyAttributed(
  {},
  { locale }
);

/**
 * The argv runner on the checkout `pages` serve, with the session it bridges,
 * as the referral cases drive it.
 */
const openRunnerCheckout = (pages: CheckoutPages) =>
  Effect.gen(function* () {
    if (!browser) return yield* Effect.die("Chromium is not running");
    const run = makePlaywrightBrowserRunner(browser, { recordHar: false });
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => run.close?.() ?? Promise.resolve())
    );
    const session = `referral-reject-test-${randomUUID()}`;
    const browserSession = yield* browserSessionFor(run, session);
    yield* showCheckout(browserSession, pages);
    return { browserSession, run, session };
  });

/** Rejects the code through the runner; the bridged session waits for the alert. */
const rejectThroughRunner = (
  invalid: boolean,
  onRejected: (url: string) => void = () => undefined,
  redirectTo?: string | null
) =>
  runCheckoutStep(
    openRunnerCheckout(
      rejectionCheckout(rejectionMessage, { invalid, redirectTo })
    ),
    (checkout) =>
      rejectReferralCode({
        ...checkout,
        code: rejectedCode,
        config,
        currentPayUrl: payUrl,
        error: rejectionError,
        locale,
        message: rejectionMessage,
        orderId,
      }).pipe(Effect.tap((url) => Effect.sync(() => onRejected(url))))
  );

test.skipIf(!chromiumAvailable)(
  "returns the re-signed pay state that keeps a rejected code with its alert",
  async () => {
    let rejectedUrl: string | undefined;
    const result = await rejectThroughRunner(true, (url) => {
      rejectedUrl = url;
    });

    expect(classify(result)).toEqual(passed);
    expect(rejectedUrl).toBe(rejectedPayUrl);
  }
);

test.skipIf(!chromiumAvailable)(
  "times out when the rejected code's field is not marked invalid",
  async () => {
    const result = await rejectThroughRunner(false);

    expect(classify(result)).toEqual(
      timedOut(
        "wait for rejected referral code kept in the field with its alert"
      )
    );
    expect(
      JSON.stringify(result.failures.map(({ message }) => message))
    ).not.toContain(rejectedCode);
  }
);

test.skipIf(!chromiumAvailable)(
  "times out a rejection that never reaches a re-signed pay state of the order",
  async () => {
    const otherOrderUrl = rejectedPayUrl.replace(
      orderId,
      "workspace-reservation-456"
    );
    for (const redirectTo of [null, otherOrderUrl]) {
      expect(
        classify(await rejectThroughRunner(true, undefined, redirectTo))
      ).toEqual(timedOut("rejected referral code on a re-signed pay state"));
    }
  },
  60_000
);

const freshPayUrl = `${origin}/${locale}/checkout/pay?payState=fresh&orderId=${orderId}`;
const appliedMessage = referralAppliedMessage(locale);

/**
 * The pay page's code box carries React-like handlers and submits to
 * `redirectTo`, which reports the applied code.
 */
const applyingCheckout = (redirectTo: string) => (url: URL) =>
  url.href === payUrl
    ? `${ordinaryCodeForm()}
      <script>
        const form = document.getElementById("checkout-discount-code-form");
        form.__reactProps$test = { onSubmit() {} };
        form.elements.submittedCode.__reactProps$test = { onChange() {} };
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          location.assign(${JSON.stringify(redirectTo)});
        });
      </script>`
    : `<p>${Bun.escapeHTML(appliedMessage)}</p>`;

const applyThroughRunner = (
  redirectTo: string,
  {
    onApplied = () => undefined,
    ownStep = false,
  }: {
    readonly onApplied?: (url: string) => void;
    /** Runs under the helper's own step and deadline, not the harness's. */
    readonly ownStep?: boolean;
  } = {}
) =>
  runCheckoutStep(
    openRunnerCheckout(applyingCheckout(redirectTo)),
    (checkout, runStep) =>
      applyCodeAndReadFreshPayUrl({
        ...checkout,
        appliedMessage,
        code: rejectedCode,
        config,
        currentPayUrl: payUrl,
        locale,
        orderId,
        runStep,
        stepId,
      }).pipe(Effect.tap((url) => Effect.sync(() => onApplied(url)))),
    { ownStep }
  );

test.skipIf(!chromiumAvailable)(
  "returns the fresh pay state an applied code re-signs",
  async () => {
    let appliedUrl: string | undefined;
    const result = await applyThroughRunner(freshPayUrl, {
      onApplied: (url) => {
        appliedUrl = url;
      },
      ownStep: true,
    });

    expect(classify(result)).toEqual(passed);
    expect(appliedUrl).toBe(freshPayUrl);
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "times out an applied code that keeps the pay state",
  async () => {
    // The fresh pay state poll runs out on its own...
    expect(classify(await applyThroughRunner(`${payUrl}&applied=1`))).toEqual(
      timedOut("fresh signed checkout pay state")
    );
    // ...and inside its own step, whose deadline ends the poll first.
    expect(
      classify(
        await applyThroughRunner(`${payUrl}&applied=1`, { ownStep: true })
      )
    ).toEqual(timedOut(`${caseId}/${stepId}`));
  },
  60_000
);
