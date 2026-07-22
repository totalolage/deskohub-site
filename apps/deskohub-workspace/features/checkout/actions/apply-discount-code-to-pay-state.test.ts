import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { CheckoutPricingServiceMock } from "@/features/checkout/backend/checkout/checkout-pricing.service.mock";
import {
  buildSignedPayState,
  openPayState,
  payStateTokenQueryParam,
  sealPayState,
} from "@/features/checkout/backend/checkout/pay-state";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote.test-utils";
import { DiscountCodeUnavailableError } from "@/features/discounts";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";

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
const quote = buildWorkspaceCheckoutQuote(reservation);

const makePayStateToken = async () => {
  const state = await Effect.runPromise(
    buildSignedPayState({
      locale: "en-US",
      reservation,
      quote,
      orderId: "reservation-id",
    })
  );

  return await Effect.runPromise(sealPayState(state));
};

const runSubmission = async (input?: {
  readonly submittedCode?: string;
  readonly applyDiscountCode?: ReturnType<typeof mock>;
  readonly activePaymentAttemptId?: string;
  readonly activePaymentAttemptIdAfterPricing?: string;
}) => {
  const [
    { applyDiscountCodeToPayState },
    { WorkspaceReservationRepository },
    { BotProtectionServiceMock },
  ] = await Promise.all([
    import("./apply-discount-code-to-pay-state"),
    import("@/features/reservation/backend/workspace-reservation.repository"),
    import("@/shared/backend/bot-protection/bot-protection.service.mock"),
  ]);
  const verifyHuman = mock(() => Effect.void);
  let reservationReadCount = 0;
  const findById = mock(() => {
    reservationReadCount += 1;
    return Effect.succeed({
      id: "reservation-id",
      dotyposCustomerId: "customer-id",
      activePaymentAttemptId:
        reservationReadCount > 1
          ? (input?.activePaymentAttemptIdAfterPricing ??
            input?.activePaymentAttemptId ??
            null)
          : (input?.activePaymentAttemptId ?? null),
    } as never);
  });
  const applyDiscountCode =
    input?.applyDiscountCode ??
    mock(() => Effect.succeed({ status: "applied" as const, quote }));
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
        Layer.succeed(WorkspaceReservationRepository, {
          findById,
        } as unknown as WorkspaceReservationRepositoryType)
      )
    ),
    Effect.runPromise
  );

  return {
    applyDiscountCode,
    findById,
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
      displayedQuote: quote,
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
    expect(freshState.submittedCode).toBe("SAVE20");
    expect(freshState.changedKeys).toBeUndefined();
    expect(scenario.result.freshPayUrl).not.toContain("SAVE20");
    expect(JSON.stringify(scenario.result)).not.toContain("SAVE20");
    expect(JSON.stringify(scenario.result)).not.toContain("save20");
  });

  test("returns one unavailable result for invalid syntax without loading checkout state", async () => {
    const scenario = await runSubmission({ submittedCode: "not valid!" });

    expect(scenario.result).toEqual({ status: "unavailable" });
    expect(scenario.findById).not.toHaveBeenCalled();
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
    expect(scenario.findById).toHaveBeenCalledTimes(2);
  });
});
