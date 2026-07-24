import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { CheckoutPricingServiceMock } from "@/features/checkout/backend/checkout/checkout-pricing.service.mock";
import {
  buildSignedPayState,
  openPayState,
  payStateTokenQueryParam,
  sealPayState,
} from "@/features/checkout/backend/checkout/pay-state";
import { PayableReservationUnavailableError } from "@/features/checkout/backend/checkout/payable-reservation.service";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import {
  DiscountCodeUnavailableError,
  discountIdSchema,
} from "@/features/discounts";

mock.module("server-only", () => ({}));

const reservation = {
  kind: "cowork" as const,
  entryTier: "basic" as const,
  coffee: false,
  date: "2026-08-04",
  name: "Ada Lovelace",
  email: "ada@example.test",
  phone: "+420777000111",
};
const quote = buildCoworkReservationQuote(reservation);
const checkoutSessionId = "checkout-session-id";
const submittedCodeDiscountId =
  Schema.decodeUnknownSync(discountIdSchema)("code-discount");

const makePayStateToken = async () => {
  const state = await Effect.runPromise(
    buildSignedPayState({
      locale: "en-US",
      reservation,
      quote,
      orderId: "reservation-id",
      checkoutSessionId,
    })
  );

  return await Effect.runPromise(sealPayState(state));
};

const runSubmission = async (input?: {
  readonly submittedCode?: string;
  readonly applyDiscountCode?: ReturnType<typeof mock>;
  readonly activePaymentAttemptId?: string;
  readonly activePaymentAttemptIdAfterPricing?: string;
  readonly payableReservationUnavailableAt?: 1 | 2;
}) => {
  const [
    { applyDiscountCodeToPayState },
    { PayableReservationService },
    { BotProtectionServiceMock },
  ] = await Promise.all([
    import("./apply-discount-code-to-pay-state"),
    import("@/features/checkout/backend/checkout/payable-reservation.service"),
    import("@/shared/backend/bot-protection/bot-protection.service.mock"),
  ]);
  const verifyHuman = mock(() => Effect.void);
  let payableReservationReadCount = 0;
  const getReservation = () => ({
    id: "reservation-id",
    dotyposCustomerId: "customer-id",
    activePaymentAttemptId:
      payableReservationReadCount > 1
        ? (input?.activePaymentAttemptIdAfterPricing ??
          input?.activePaymentAttemptId ??
          null)
        : (input?.activePaymentAttemptId ?? null),
  });
  const requireCurrent = mock(() => {
    payableReservationReadCount += 1;
    return input?.payableReservationUnavailableAt ===
      payableReservationReadCount
      ? Effect.fail(
          new PayableReservationUnavailableError({
            orderId: "reservation-id",
            reason: "not_current",
          })
        )
      : Effect.succeed(getReservation() as never);
  });
  const applyDiscountCode =
    input?.applyDiscountCode ??
    mock(() =>
      Effect.succeed({
        kind: "cowork" as const,
        reservation,
        status: "applied" as const,
        submittedCodeDiscountId,
        quote,
      })
    );
  const payStateToken = await makePayStateToken();
  const result = await applyDiscountCodeToPayState({
    locale: "en-US",
    payStateToken,
    submittedCode: input?.submittedCode ?? " save20 ",
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        BotProtectionServiceMock({ verifyHuman }),
        CheckoutPricingServiceMock({ applyDiscountCode }),
        Layer.succeed(PayableReservationService, { requireCurrent })
      )
    ),
    Effect.runPromise
  );

  return {
    applyDiscountCode,
    requireCurrent,
    payStateToken,
    result,
    verifyHuman,
  };
};

describe("applyDiscountCodeToPayState", () => {
  test("seals a canonical code privately into a replacement pay state", async () => {
    const scenario = await runSubmission();

    expect(scenario.verifyHuman).toHaveBeenCalledWith({
      verificationFailurePolicy: "deny",
    });
    expect(scenario.applyDiscountCode).toHaveBeenCalledWith({
      reservation: expect.objectContaining({
        entryTier: "basic",
        date: reservation.date,
      }),
      dotyposCustomerId: "customer-id",
      locale: "en-US",
      quote,
      submittedCode: "SAVE20",
    });
    expect(scenario.result.status).toBe("applied");
    if (scenario.result.status !== "applied") {
      throw new Error("Expected applied result");
    }

    const freshUrl = new URL(
      scenario.result.freshPayUrl,
      "https://deskohub.test"
    );
    const freshToken = freshUrl.searchParams.get(payStateTokenQueryParam);
    expect(freshToken).toBeTruthy();
    const freshState = await Effect.runPromise(openPayState(freshToken ?? ""));
    expect(freshState.checkoutSessionId).toBe(checkoutSessionId);
    expect(freshState.submittedCode).toBe("SAVE20");
    expect(freshState.submittedCodeDiscountId).toBe(submittedCodeDiscountId);
    expect(freshState.changedKeys).toBeUndefined();
    expect(scenario.result.freshPayUrl).not.toContain("SAVE20");
    expect(JSON.stringify(scenario.result)).not.toContain("SAVE20");
    expect(JSON.stringify(scenario.result)).not.toContain("save20");
  });

  test("returns one unavailable result for invalid syntax without loading checkout state", async () => {
    const scenario = await runSubmission({ submittedCode: "not valid!" });

    expect(scenario.result).toEqual({ status: "unavailable" });
    expect(scenario.requireCurrent).not.toHaveBeenCalled();
    expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
    await expect(
      Effect.runPromise(openPayState(scenario.payStateToken))
    ).resolves.toMatchObject({ orderId: "reservation-id" });
  });

  test("maps a specific backend eligibility reason to the generic field result", async () => {
    const applyDiscountCode = mock(() =>
      Effect.fail(
        new DiscountCodeUnavailableError({
          reason: "already_redeemed",
          message: "Already redeemed.",
        })
      )
    );
    const scenario = await runSubmission({ applyDiscountCode });

    expect(scenario.result).toEqual({ status: "unavailable" });
    expect(applyDiscountCode).toHaveBeenCalledTimes(1);
  });

  test("returns a refreshed pricing_changed state before applying the code", async () => {
    const changedKeys = {
      sectionKeys: ["order", "total"],
      itemKeys: ["product:cowork:basic", "total:final"],
    };
    const applyDiscountCode = mock(() =>
      Effect.succeed({
        kind: "cowork" as const,
        reservation,
        status: "pricing_changed" as const,
        quote,
        changedKeys,
      })
    );
    const scenario = await runSubmission({ applyDiscountCode });

    expect(scenario.result.status).toBe("pricing_changed");
    if (scenario.result.status !== "pricing_changed") {
      throw new Error("Expected pricing_changed result");
    }

    const freshToken = new URL(
      scenario.result.freshPayUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    const freshState = await Effect.runPromise(openPayState(freshToken ?? ""));
    expect(freshState.checkoutSessionId).toBe(checkoutSessionId);
    expect(freshState.changedKeys).toEqual(changedKeys);
    expect(freshState.submittedCode).toBeUndefined();
  });

  test("does not reprice after a payment attempt has become active", async () => {
    const scenario = await runSubmission({
      activePaymentAttemptId: "attempt-id",
    });

    expect(scenario.result).toEqual({ status: "unavailable" });
    expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
  });

  test("discards a replacement summary when payment starts during repricing", async () => {
    const scenario = await runSubmission({
      activePaymentAttemptIdAfterPricing: "attempt-id",
    });

    expect(scenario.result).toEqual({ status: "unavailable" });
    expect(scenario.applyDiscountCode).toHaveBeenCalledTimes(1);
    expect(scenario.requireCurrent).toHaveBeenCalledTimes(2);
  });

  test("does not reprice a reservation that is no longer payable", async () => {
    const scenario = await runSubmission({
      payableReservationUnavailableAt: 1,
    });

    expect(scenario.result).toEqual({ status: "unavailable" });
    expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
    expect(scenario.requireCurrent).toHaveBeenCalledTimes(1);
  });

  test("discards repricing when the reservation stops being payable", async () => {
    const scenario = await runSubmission({
      payableReservationUnavailableAt: 2,
    });

    expect(scenario.result).toEqual({ status: "unavailable" });
    expect(scenario.applyDiscountCode).toHaveBeenCalledTimes(1);
    expect(scenario.requireCurrent).toHaveBeenCalledTimes(2);
  });
});
