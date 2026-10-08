import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { isFreshOwnedPayStateUrl } from "@/e2e/account/referral-checkout";
import { isOwnedReferralCheckoutReviewUrl } from "@/e2e/account/referral-checkout-review";
import type { WorkspaceE2EConfig } from "@/e2e/config";
import { buildFreshCheckoutPayPath } from "@/features/checkout/backend/checkout/checkout-pay-url";
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
  discountIdSchema,
  PromotionCodeUnavailableError,
} from "@/features/discounts";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

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

const makePayStateToken = async (input?: {
  readonly requestedDiscountCode?: CanonicalPromotionCode;
}) => {
  const state = await Effect.runPromise(
    buildSignedPayState({
      locale: "en-US",
      reservation,
      quote,
      orderId: "reservation-id",
      checkoutSessionId,
      requestedDiscountCode: input?.requestedDiscountCode,
    })
  );

  return await Effect.runPromise(sealPayState(state));
};

const runSubmission = async (input?: {
  readonly submittedCode?: string;
  readonly applyDiscountCode?: ReturnType<typeof mock>;
  readonly acceptCode?: ReturnType<typeof mock>;
  readonly codeKind?: "referral" | "other";
  readonly payStateToken?: string;
  readonly activePaymentAttemptId?: string;
  readonly activePaymentAttemptIdAfterPricing?: string;
  readonly payableReservationUnavailableAt?: 1 | 2;
  readonly requestedDiscountCode?: CanonicalPromotionCode;
}) => {
  const [
    { applyDiscountCodeToPayState },
    { PayableReservationService },
    { CheckoutReferralService },
    { ReferralService },
    { BotProtectionServiceMock },
  ] = await Promise.all([
    import("./apply-discount-code-to-pay-state"),
    import("@/features/checkout/backend/checkout/payable-reservation.service"),
    import("@/features/checkout/backend/checkout"),
    import("@/features/referrals"),
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
  const lookupCodeKind = mock(() =>
    Effect.succeed({ kind: input?.codeKind ?? "other" } as const)
  );
  const acceptCode =
    input?.acceptCode ??
    mock(() =>
      Effect.succeed({
        status: "accepted" as const,
        freshPayUrl: "/en-US/checkout/pay?payState=fresh",
      })
    );
  const payStateToken =
    input?.payStateToken ??
    (await makePayStateToken({
      requestedDiscountCode: input?.requestedDiscountCode,
    }));
  const result = await applyDiscountCodeToPayState({
    locale: "en-US",
    payStateToken,
    submittedCode: input?.submittedCode ?? " save20 ",
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        BotProtectionServiceMock({ verifyHuman }),
        CheckoutPricingServiceMock({ applyDiscountCode }),
        Layer.succeed(PayableReservationService, { requireCurrent }),
        Layer.succeed(ReferralService, { lookupCodeKind } as never),
        Layer.succeed(CheckoutReferralService, { acceptCode } as never)
      )
    ),
    Effect.runPromise
  );

  return {
    applyDiscountCode,
    acceptCode,
    lookupCodeKind,
    requireCurrent,
    payStateToken,
    result,
    verifyHuman,
  };
};

describe("applyDiscountCodeToPayState", () => {
  test("routes a referral through explicit acceptance and leaves the ordinary code slot free", async () => {
    const acceptCode = mock((input: { readonly payStateToken: string }) =>
      Effect.gen(function* () {
        const opened = yield* openPayState(input.payStateToken);
        const freshPayUrl = yield* buildFreshCheckoutPayPath({
          ...opened,
          submittedCode: undefined,
          submittedCodeDiscountId: undefined,
        });
        return { status: "accepted" as const, freshPayUrl };
      })
    );
    const referral = await runSubmission({
      submittedCode: "RFL12345",
      codeKind: "referral",
      acceptCode,
    });

    expect(referral.lookupCodeKind).toHaveBeenCalledWith({ code: "RFL12345" });
    expect(acceptCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: "RFL12345", locale: "en-US" })
    );
    expect(referral.applyDiscountCode).not.toHaveBeenCalled();
    expect(referral.requireCurrent).not.toHaveBeenCalled();
    expect(referral.result.status).toBe("accepted");
    if (referral.result.status !== "accepted") {
      throw new Error("Expected accepted referral result");
    }
    const acceptedToken = new URL(
      referral.result.freshPayUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    expect(acceptedToken).toBeTruthy();
    const acceptedState = await Effect.runPromise(
      openPayState(acceptedToken ?? "")
    );
    expect(acceptedState).not.toHaveProperty("submittedCode");
    expect(acceptedState).not.toHaveProperty("submittedCodeDiscountId");

    const ordinary = await runSubmission({
      submittedCode: "SAVE20",
      codeKind: "other",
      payStateToken: acceptedToken ?? "",
    });
    expect(ordinary.applyDiscountCode).toHaveBeenCalledWith(
      expect.objectContaining({ submittedCode: "SAVE20" })
    );
    expect(ordinary.result.status).toBe("applied");
  });

  test("returns an unavailable referral result without falling through to promotion pricing", async () => {
    const acceptCode = mock(() =>
      Effect.succeed({ status: "unavailable" as const })
    );
    const scenario = await runSubmission({
      submittedCode: "RFL12345",
      codeKind: "referral",
      acceptCode,
    });

    expect(scenario.result).toEqual({ status: "unavailable" });
    expect(acceptCode).toHaveBeenCalledTimes(1);
    expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
    expect(scenario.requireCurrent).not.toHaveBeenCalled();
  });

  test("seals a canonical code privately into a replacement pay state", async () => {
    const scenario = await runSubmission();

    expect(scenario.verifyHuman).toHaveBeenCalledWith({
      verificationFailurePolicy: "deny",
    });
    expect(scenario.applyDiscountCode).toHaveBeenCalledWith(
      expect.objectContaining({
        reservation: expect.objectContaining({
          entryTier: "basic",
          date: reservation.date,
        }),
        dotyposCustomerId: "customer-id",
        locale: "en-US",
        quote,
        submittedCode: "SAVE20",
      })
    );
    expect(scenario.result.status).toBe("applied");
    if (scenario.result.status !== "applied") {
      throw new Error("Expected applied result");
    }

    const freshUrl = new URL(
      scenario.result.freshPayUrl,
      "https://deskohub.test"
    );
    expect(freshUrl.searchParams.get("orderId")).toBe("reservation-id");
    const freshToken = freshUrl.searchParams.get(payStateTokenQueryParam);
    expect(freshToken).toBeTruthy();
    const freshState = await Effect.runPromise(openPayState(freshToken ?? ""));
    expect(freshState.checkoutSessionId).toBe(checkoutSessionId);
    expect(freshState.submittedCode).toBe("SAVE20");
    expect(freshState.submittedCodeDiscountId).toBe(submittedCodeDiscountId);
    expect(freshState.requestedDiscountCode).toBe("SAVE20");
    expect(freshState.changedKeys).toBeUndefined();
    expect(scenario.result.freshPayUrl).not.toContain("SAVE20");
    expect(JSON.stringify(scenario.result)).not.toContain("SAVE20");
    expect(JSON.stringify(scenario.result)).not.toContain("save20");
  });

  test("real refreshed action URLs satisfy both owned checkout guards", async () => {
    const scenario = await runSubmission();
    if (scenario.result.status !== "applied") {
      throw new Error("Expected applied result");
    }

    const orderId = "reservation-id" as WorkspaceReservationId;
    const baseUrl = "https://deskohub.test";
    const currentUrl = new URL(scenario.result.freshPayUrl, baseUrl).href;
    const previousUrl = new URL(
      `/en-US/checkout/pay?payState=${encodeURIComponent(scenario.payStateToken)}&orderId=${orderId}`,
      baseUrl
    ).href;
    const config = { baseUrl } as WorkspaceE2EConfig;

    expect([
      isFreshOwnedPayStateUrl(
        currentUrl,
        previousUrl,
        config,
        "en-US",
        orderId
      ),
      isOwnedReferralCheckoutReviewUrl({
        actualUrl: currentUrl,
        baseUrl,
        expectedUrl: currentUrl,
        orderId,
      }),
    ]).toEqual([true, true]);
  });

  test("returns one unavailable result for invalid syntax without loading checkout state", async () => {
    const scenario = await runSubmission({ submittedCode: "not valid!" });

    expect(scenario.result).toEqual({
      status: "unavailable",
      freshPayUrl: undefined,
    });
    expect(scenario.requireCurrent).not.toHaveBeenCalled();
    expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
    await expect(
      Effect.runPromise(openPayState(scenario.payStateToken))
    ).resolves.toMatchObject({ orderId: "reservation-id" });
  });

  test.each(["", "   "])(
    "returns plain unavailable for empty or whitespace input %j without lookups or pricing",
    async (submittedCode) => {
      const scenario = await runSubmission({ submittedCode });

      expect(scenario.result).toEqual({
        status: "unavailable",
        freshPayUrl: undefined,
      });
      expect(scenario.requireCurrent).not.toHaveBeenCalled();
      expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
      await expect(
        Effect.runPromise(openPayState(scenario.payStateToken))
      ).resolves.toMatchObject({ orderId: "reservation-id" });
    }
  );

  test("maps a specific backend eligibility reason to the generic field result while retaining the attempt", async () => {
    const applyDiscountCode = mock(() =>
      Effect.fail(
        new PromotionCodeUnavailableError({
          reason: "already_redeemed",
          message: "Already redeemed.",
        })
      )
    );
    const scenario = await runSubmission({ applyDiscountCode });

    expect(scenario.result.status).toBe("unavailable");
    expect(applyDiscountCode).toHaveBeenCalledTimes(1);
    if (scenario.result.status !== "unavailable") {
      throw new Error("Expected unavailable result");
    }
    expect(scenario.result.freshPayUrl).toBeTruthy();

    const freshUrl = new URL(
      scenario.result.freshPayUrl ?? "",
      "https://deskohub.test"
    );
    expect(freshUrl.searchParams.get("orderId")).toBe("reservation-id");
    expect(freshUrl.searchParams.get("discountCodeError")).toBe("unavailable");
    const freshToken = freshUrl.searchParams.get(payStateTokenQueryParam);
    const freshState = await Effect.runPromise(openPayState(freshToken ?? ""));
    expect(freshState.orderId).toBe("reservation-id");
    expect(freshState.requestedDiscountCode).toBe("SAVE20");
    expect(freshState.submittedCode).toBeUndefined();
    expect(freshState.submittedCodeDiscountId).toBeUndefined();
    expect(scenario.result.freshPayUrl).not.toContain("SAVE20");
  });

  test("applies a new code when the signed state only carries a requested code", async () => {
    const scenario = await runSubmission({
      requestedDiscountCode: "CAMPAIGN10",
    });

    expect(scenario.applyDiscountCode).toHaveBeenCalledTimes(1);
    expect(scenario.result.status).toBe("applied");
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

    const freshUrl = new URL(
      scenario.result.freshPayUrl,
      "https://deskohub.test"
    );
    expect(freshUrl.searchParams.get("orderId")).toBe("reservation-id");
    const freshToken = freshUrl.searchParams.get(payStateTokenQueryParam);
    const freshState = await Effect.runPromise(openPayState(freshToken ?? ""));
    expect(freshState.checkoutSessionId).toBe(checkoutSessionId);
    expect(freshState.changedKeys).toEqual(changedKeys);
    expect(freshState.submittedCode).toBeUndefined();
    expect(freshState.requestedDiscountCode).toBe("SAVE20");
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
