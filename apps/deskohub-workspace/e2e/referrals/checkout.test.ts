import "@/shared/testing/workspace-test-env";

import { expect, test } from "bun:test";
import { basename, dirname, resolve } from "node:path";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Cause, Effect, Exit, Layer } from "effect";
import { buildFreshCheckoutPayPath } from "@/features/checkout/backend/checkout/checkout-pay-url";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { getReservationCustomerQueryMode } from "@/features/reservation/reservation-checkout-query";
import { currencyCZK } from "@/shared/money/currencies";
import { instantStringSchema } from "@/shared/utils/temporal";
import { createCensoredOtelSpanExporter } from "../../shared/backend/logging/censorship";
import { createTracingLive } from "../../shared/backend/observability/otel-tracing";
import { makeCoworkCheckoutData } from "../checkout/data";
import type { WorkspaceE2EConfig } from "../config";
import { makeTestE2EEnvironment } from "../e2e-env.test-fixture";
import { isWorkspaceE2ETimeout, workspaceE2ETimeoutError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import type { Runner } from "../runtime";
import { workspaceDir } from "../runtime";
import {
  E2ERunContextService,
  E2ETelemetryService,
} from "../services/telemetry";
import {
  assertOrdinaryCodeSlotAvailable,
  bindCheckoutContact,
  calculateSingleInviteeReferralDiscount,
  isFreshOwnedPayStateUrl,
  isReferralAppliedPayUrl,
  isRejectedReferralCodeUrl,
} from "./checkout";
import {
  getWorkspaceE2EReferralCheckoutReviewArtifactPath,
  isOwnedReferralCheckoutReviewUrl,
} from "./checkout-review";

const customerId = DotyposCustomerIdSchema.make("workspace-e2e-referral-owner");
const contact = {
  customerId,
  email: testEmailAddress("delivered+account-referral"),
  name: "E2E Lane",
  phone: "+420 555 000 111",
} as const;

test("expects a fixed 5% referrer amount after one invitation and an ordinary code", () => {
  const openSpace = getWorkspaceProductByTier("open-space").price;
  const afterOrdinaryCode = {
    ...openSpace,
    value: openSpace.value - Math.round((openSpace.value * 1000) / 10_000),
  };
  const afterInvitation = {
    ...afterOrdinaryCode,
    value:
      afterOrdinaryCode.value -
      Math.round((afterOrdinaryCode.value * 1500) / 10_000),
  };
  const expected = calculateSingleInviteeReferralDiscount(afterInvitation);

  expect(expected).toEqual(currencyCZK(1_109));
  expect(
    formatDiscountAdjustment(
      { kind: "fixed", amount: expected },
      "en-US"
    ).replaceAll("\u00a0", " ")
  ).toContain("11.09");
});

test("opens a bound checkout on the signed-in account card, not for someone else", () => {
  const planned = makeCoworkCheckoutData(
    "https://workspace.example.test",
    "2099-09-01"
  );
  const contactOnly = new URL(planned.checkoutUrl);
  for (const [key, value] of Object.entries({
    email: contact.email,
    name: contact.name,
    phone: contact.phone,
  })) {
    contactOnly.searchParams.set(key, value);
  }
  // Contact fields alone book for someone else, which only prefills a
  // remembered referral instead of applying it.
  expect(getReservationCustomerQueryMode(contactOnly.searchParams)).toBe(
    "contact"
  );

  const bound = new URL(bindCheckoutContact(planned, contact).checkoutUrl);

  expect(getReservationCustomerQueryMode(bound.searchParams)).toBe("account");
});

test("accepts only fresh signed pay URLs for the owned order and preview host", () => {
  const config = {
    baseUrl: "https://workspace.example.test",
    locale: "en-US",
  } as WorkspaceE2EConfig;
  const orderId = "workspace-reservation-123" as WorkspaceReservationId;
  const initial =
    "https://workspace.example.test/en-US/checkout/pay?payState=first&orderId=workspace-reservation-123";
  const fresh =
    "https://workspace.example.test/en-US/checkout/pay?payState=second&orderId=workspace-reservation-123";

  expect(
    isFreshOwnedPayStateUrl(fresh, initial, config, "en-US", orderId)
  ).toBe(true);
  expect(
    isFreshOwnedPayStateUrl(
      "https://workspace.example.test/en-US/checkout/pay?payState=first&orderId=workspace-reservation-123",
      initial,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isFreshOwnedPayStateUrl(
      "https://elsewhere.example.test/en-US/checkout/pay?payState=second&orderId=workspace-reservation-123",
      initial,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: fresh,
      baseUrl: config.baseUrl,
      expectedUrl: fresh,
      orderId,
    })
  ).toBe(true);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: `${fresh}&ref=RFL12345`,
      baseUrl: config.baseUrl,
      expectedUrl: `${fresh}&ref=RFL12345`,
      orderId,
    })
  ).toBe(false);
});

test("both ownership guards accept and constrain URLs from the real fresh-pay builder", async () => {
  const orderId = "workspace-reservation-123" as WorkspaceReservationId;
  const baseUrl = "https://workspace.example.test";
  const config = { baseUrl } as WorkspaceE2EConfig;
  const reservation = {
    kind: "cowork" as const,
    entryTier: "basic" as const,
    coffee: false,
    date: "2099-09-01",
    name: "Synthetic E2E",
    email: testEmailAddress("delivered+referral-url"),
    phone: "+420 555 000 111",
  };
  const input = {
    locale: "en-US" as const,
    orderId,
    checkoutSessionId: "checkout-session-referral-url",
    bookedAt: instantStringSchema.make("2026-06-01T09:58:00.000Z"),
    reservation,
    quote: buildCoworkReservationQuote(reservation),
  };
  const buildPayUrl = () =>
    Effect.runPromise(buildFreshCheckoutPayPath(input, {}, { orderId })).then(
      (path) => new URL(path, baseUrl).href
    );
  const [previousUrl, freshUrl] = await Promise.all([
    buildPayUrl(),
    buildPayUrl(),
  ]);

  expect(
    isFreshOwnedPayStateUrl(freshUrl, previousUrl, config, "en-US", orderId)
  ).toBe(true);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: freshUrl,
      baseUrl,
      expectedUrl: freshUrl,
      orderId,
    })
  ).toBe(true);

  const wrongOrderUrl = new URL(freshUrl);
  wrongOrderUrl.searchParams.set("orderId", "another-workspace-reservation");
  const duplicateOrderUrl = new URL(freshUrl);
  duplicateOrderUrl.searchParams.append("orderId", orderId);
  const duplicatePayStateUrl = new URL(freshUrl);
  duplicatePayStateUrl.searchParams.append(
    "payState",
    duplicatePayStateUrl.searchParams.get("payState") ?? ""
  );
  const referredUrl = new URL(freshUrl);
  referredUrl.searchParams.set("ref", "RFL12345");
  const submittedCodeUrl = new URL(freshUrl);
  submittedCodeUrl.searchParams.set("submittedCode", "SAVE20");
  const missingOrderIdUrl = new URL(freshUrl);
  missingOrderIdUrl.searchParams.delete("orderId");
  const externalUrl = new URL(freshUrl);
  externalUrl.hostname = "elsewhere.example.test";

  expect(
    isFreshOwnedPayStateUrl(
      wrongOrderUrl.href,
      previousUrl,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: wrongOrderUrl.href,
      baseUrl,
      expectedUrl: wrongOrderUrl.href,
      orderId,
    })
  ).toBe(false);
  expect(
    isFreshOwnedPayStateUrl(
      duplicateOrderUrl.href,
      previousUrl,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isFreshOwnedPayStateUrl(
      duplicatePayStateUrl.href,
      previousUrl,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: duplicateOrderUrl.href,
      baseUrl,
      expectedUrl: duplicateOrderUrl.href,
      orderId,
    })
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: duplicatePayStateUrl.href,
      baseUrl,
      expectedUrl: duplicatePayStateUrl.href,
      orderId,
    })
  ).toBe(false);
  expect(
    isFreshOwnedPayStateUrl(
      referredUrl.href,
      previousUrl,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: referredUrl.href,
      baseUrl,
      expectedUrl: referredUrl.href,
      orderId,
    })
  ).toBe(false);
  expect(
    isFreshOwnedPayStateUrl(
      submittedCodeUrl.href,
      previousUrl,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: submittedCodeUrl.href,
      baseUrl,
      expectedUrl: submittedCodeUrl.href,
      orderId,
    })
  ).toBe(false);
  expect(
    isFreshOwnedPayStateUrl(
      missingOrderIdUrl.href,
      previousUrl,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: missingOrderIdUrl.href,
      baseUrl,
      expectedUrl: missingOrderIdUrl.href,
      orderId,
    })
  ).toBe(false);
  expect(
    isFreshOwnedPayStateUrl(
      externalUrl.href,
      previousUrl,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: externalUrl.href,
      baseUrl,
      expectedUrl: externalUrl.href,
      orderId,
    })
  ).toBe(false);
});

test("accepts only the owned first pay page that reports the share-link referral", () => {
  const baseUrl = "https://workspace.example.test";
  const orderId = "workspace-reservation-123" as WorkspaceReservationId;
  const payUrl = (query: string) =>
    `${baseUrl}/en-US/checkout/pay?payState=signed&orderId=${orderId}${query}`;
  const accepts = (currentUrl: string) =>
    isReferralAppliedPayUrl({ baseUrl, currentUrl, locale: "en-US", orderId });

  expect(accepts(payUrl("&referralApplied=1"))).toBe(true);
  for (const rejected of [
    payUrl(""),
    payUrl("&referralApplied=0"),
    payUrl("&referralApplied=1&referralApplied=1"),
    payUrl("&referralApplied=1&ref=RFL12345"),
    payUrl("&referralApplied=1&submittedCode=RFL12345"),
    payUrl("&referralApplied=1&discountCodeError=referral-ineligible"),
    payUrl("&referralApplied=1").replace(orderId, "workspace-reservation-456"),
    payUrl("&referralApplied=1").replace("/en-US/", "/cs-CZ/"),
    payUrl("&referralApplied=1").replace(baseUrl, "https://other.example.test"),
    `${baseUrl}/en-US/checkout/pay?orderId=${orderId}&referralApplied=1`,
    "not a url",
  ]) {
    expect(accepts(rejected)).toBe(false);
  }
});

test("accepts only a rejected referral code on a re-signed pay state", () => {
  const baseUrl = "https://workspace.example.test";
  const orderId = "workspace-reservation-123" as WorkspaceReservationId;
  const previousUrl = `${baseUrl}/en-US/checkout/pay?payState=signed&orderId=${orderId}`;
  const accepts = (currentUrl: string) =>
    isRejectedReferralCodeUrl({
      baseUrl,
      currentUrl,
      error: "referral-already-attributed",
      locale: "en-US",
      orderId,
      previousUrl,
    });
  const rejected = `${baseUrl}/en-US/checkout/pay?payState=fresh&orderId=${orderId}&discountCodeError=referral-already-attributed&discountCodeErrorId=synthetic`;

  expect(accepts(rejected)).toBe(true);
  for (const candidate of [
    previousUrl,
    rejected.replace("payState=fresh", "payState=signed"),
    rejected.replace("referral-already-attributed", "referral-ineligible"),
    `${rejected}&discountCodeError=referral-already-attributed`,
    `${rejected}&referralApplied=1`,
    `${rejected}&ref=RFL12345`,
    `${rejected}&submittedCode=RFL12345`,
    rejected.replace(orderId, "workspace-reservation-456"),
    "not a url",
  ]) {
    expect(accepts(candidate)).toBe(false);
  }
});

test("writes checkout review PNGs into the account-review artifact bundle", () => {
  const artifact = getWorkspaceE2EReferralCheckoutReviewArtifactPath(
    "account-referral-with-voucher"
  );

  expect(dirname(artifact)).toBe(
    resolve(workspaceDir, "e2e-artifacts", "account-review")
  );
  expect(basename(artifact)).toBe("account-referral-with-voucher.png");
});

test("exports bounded ordinary-code form state from the referral assertion", async () => {
  const failedObservation = await observeOrdinaryCodeSlot({
    formVisible: false,
    formCount: 12,
    inputValue: "SYNTHETIC-PRIVATE-CODE",
    namedFieldCount: 11,
    timeoutStep: true,
    waitForAbort: true,
  });
  const failureSpan = failedObservation.spans.find(
    (span) =>
      span.name === "e2e.step" &&
      span.attributes["e2e.step.id"] ===
        "assert-ordinary-code-slot-after-referral"
  );

  expect(failedObservation.exit._tag).toBe("Failure");
  expect(failedObservation.calls.waitSignalAborted).toBe(true);
  expect(failedObservation.calls.observationReadCount).toBe(1);
  expect(
    Exit.isFailure(failedObservation.exit) &&
      isWorkspaceE2ETimeout(Cause.squash(failedObservation.exit.cause))
  ).toBe(true);
  expect(failureSpan).toBeDefined();
  expect(failureSpan?.attributes).toMatchObject({
    "e2e.account.discount_form.form_count": 9,
    "e2e.account.discount_form.named_field_count": 9,
    "e2e.account.discount_form.selected_form_present": 1,
    "e2e.account.discount_form.selected_form_visible": 0,
    "e2e.account.discount_form.named_input_present": 1,
    "e2e.account.discount_form.named_input_enabled": 1,
    "e2e.account.discount_form.named_input_empty": 0,
    "e2e.account.discount_form.submit_present": 1,
    "e2e.account.discount_form.submit_enabled": 1,
  });
  const exported = JSON.stringify(failedObservation.spans);
  for (const privateValue of [
    "SYNTHETIC-PRIVATE-CODE",
    "submittedCode",
    "workspace.example.test",
    "payState=initial",
    "RFL12345",
  ]) {
    expect(exported).not.toContain(privateValue);
  }

  const successfulObservation = await observeOrdinaryCodeSlot({
    formVisible: true,
    formCount: 1,
    inputValue: "",
    namedFieldCount: 1,
  });
  const successSpan = successfulObservation.spans.find(
    (span) =>
      span.name === "e2e.step" &&
      span.attributes["e2e.step.id"] ===
        "assert-ordinary-code-slot-after-referral"
  );

  expect(successfulObservation.exit._tag).toBe("Success");
  expect(successSpan?.attributes).toMatchObject({
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
});

test("observer failure does not replace the referral-slot timeout", async () => {
  const observation = await observeOrdinaryCodeSlot({
    formVisible: true,
    formCount: 1,
    inputValue: "SYNTHETIC-PRIVATE-CODE",
    namedFieldCount: 1,
    observerFailure: true,
    timeoutStep: true,
    waitForAbort: true,
  });
  const span = observation.spans.find(
    (candidate) =>
      candidate.name === "e2e.step" &&
      candidate.attributes["e2e.step.id"] ===
        "assert-ordinary-code-slot-after-referral"
  );

  expect(
    Exit.isFailure(observation.exit) &&
      isWorkspaceE2ETimeout(Cause.squash(observation.exit.cause))
  ).toBe(true);
  expect(observation.calls.waitSignalAborted).toBe(true);
  expect(observation.calls.observationReadCount).toBe(1);
  expect(span?.attributes).toMatchObject({
    "e2e.failure.kind": "timeout",
    "e2e.outcome": "timed_out",
  });
  expect(
    Object.keys(span?.attributes ?? {}).filter((key) =>
      key.startsWith("e2e.account.discount_form.")
    )
  ).toEqual([]);
  expect(JSON.stringify(observation.spans)).not.toContain(
    "SYNTHETIC-PRIVATE-OBSERVER-FAILURE"
  );
});

const observeOrdinaryCodeSlot = async ({
  formVisible,
  formCount,
  inputValue,
  namedFieldCount,
  observerFailure = false,
  timeoutStep = false,
  waitForAbort = false,
}: {
  readonly formVisible: boolean;
  readonly formCount: number;
  readonly inputValue: string;
  readonly namedFieldCount: number;
  readonly observerFailure?: boolean;
  readonly timeoutStep?: boolean;
  readonly waitForAbort?: boolean;
}) => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [
      new SimpleSpanProcessor(createCensoredOtelSpanExporter(exporter)),
    ],
  });
  const tracingLayer = createTracingLive({
    provider,
    serviceName: "deskohub-workspace-referral-checkout-test",
  });
  const telemetryLayer = E2ETelemetryService.Default.pipe(
    Layer.provide(E2ERunContextService.layer(makeTestE2EEnvironment()))
  );
  const layer = Layer.merge(
    Layer.merge(tracingLayer, telemetryLayer),
    Layer.succeed(E2EDatabase, E2EDatabase.of({ db: {} as never }))
  );
  const { calls, run } = makeOrdinaryCodeSlotRunner({
    formCount,
    formVisible,
    inputValue,
    namedFieldCount,
    observerFailure,
    waitForAbort,
  });
  const config = {
    baseUrl: "https://workspace.example.test",
    locale: "en-US",
    timeouts: { uiTransition: 50 },
  } as WorkspaceE2EConfig;
  const step = {
    execute: assertOrdinaryCodeSlotAvailable({
      config,
      run,
      session: "synthetic-session",
    }),
    id: "assert-ordinary-code-slot-after-referral",
    timeoutMs: config.timeouts.uiTransition,
  };
  const execute = Effect.gen(function* () {
    const telemetry = yield* E2ETelemetryService;
    yield* telemetry.traceStep({
      caseId: "referral-checkout-code-entry",
      effect: timeoutStep
        ? step.execute.pipe(
            Effect.timeoutOrElse({
              duration: `${step.timeoutMs} millis`,
              orElse: () =>
                workspaceE2ETimeoutError(
                  "synthetic ordinary-code slot deadline expired",
                  { operation: "assert ordinary-code slot after referral" }
                ),
            })
          )
        : step.execute,
      stepId: step.id,
      timeoutMs: step.timeoutMs,
    });
  });

  try {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(execute).pipe(Effect.provide(layer))
    );
    await provider.forceFlush();
    return { calls, exit, spans: exporter.getFinishedSpans() };
  } finally {
    await provider.shutdown();
  }
};

const makeOrdinaryCodeSlotRunner = ({
  formCount,
  formVisible,
  inputValue,
  namedFieldCount,
  observerFailure,
  waitForAbort,
}: {
  readonly formCount: number;
  readonly formVisible: boolean;
  readonly inputValue: string;
  readonly namedFieldCount: number;
  readonly observerFailure: boolean;
  readonly waitForAbort: boolean;
}): {
  readonly calls: { observationReadCount: number; waitSignalAborted: boolean };
  readonly run: Runner;
} => {
  class SyntheticInput {
    disabled = false;
    value = inputValue;
  }
  class SyntheticButton {
    disabled = false;
  }
  const input = new SyntheticInput();
  const submit = new SyntheticButton();
  const forms = Array.from({ length: formCount }, (_, index) => ({
    getClientRects: () => (index === 0 && formVisible ? [{}] : []),
    querySelector: (selector: string) =>
      selector.startsWith("input[")
        ? input
        : selector.startsWith("button[")
          ? submit
          : null,
  }));
  const document = {
    querySelector: (selector: string) =>
      selector === "#checkout-discount-code-form" ? (forms[0] ?? null) : null,
    querySelectorAll: (selector: string) =>
      selector === "#checkout-discount-code-form"
        ? forms
        : selector === 'input[name="submittedCode"]'
          ? Array.from({ length: namedFieldCount }, () => input)
          : [],
  };
  const window = {
    getComputedStyle: (element: unknown) => ({
      display: element === forms[0] && formVisible ? "block" : "none",
      visibility: element === forms[0] && formVisible ? "visible" : "hidden",
    }),
  } as Record<string, unknown>;
  const calls = { observationReadCount: 0, waitSignalAborted: false };

  const run: Runner = async (_command, args, options) => {
    const command = args[2];
    if (command === "wait") {
      const predicate = args[4];
      if (!predicate) throw new Error("synthetic predicate missing");
      const matched = Function(
        "document",
        "window",
        "HTMLInputElement",
        "HTMLButtonElement",
        `return ${predicate}`
      )(document, window, SyntheticInput, SyntheticButton);
      if (!matched && !waitForAbort)
        throw new Error("synthetic wait condition timed out");
      if (!matched) {
        const signal = options?.signal;
        if (!signal) throw new Error("synthetic wait signal missing");
        if (signal.aborted) {
          calls.waitSignalAborted = true;
          throw signal.reason;
        }
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              calls.waitSignalAborted = true;
              reject(signal.reason);
            },
            { once: true }
          );
        });
      }
      return { exitCode: 0, stderr: "", stdout: "" };
    }
    if (command === "eval") {
      calls.observationReadCount += 1;
      if (observerFailure)
        throw new Error("SYNTHETIC-PRIVATE-OBSERVER-FAILURE");
      const script = options?.input;
      if (!script) throw new Error("synthetic observer script missing");
      const value = Function("window", `return ${script}`)(window);
      return {
        exitCode: 0,
        stderr: "",
        stdout: value === undefined ? "" : JSON.stringify(value),
      };
    }
    throw new Error("unexpected synthetic browser command");
  };
  return { calls, run };
};
