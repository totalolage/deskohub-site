import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type { GoogleCalendarEvent } from "@deskohub/google-calendar";
import { testEmailAddress } from "@deskohub/test-email";
import { type Duration, Effect, Layer, Schema } from "effect";
import type { WorkspaceE2EConfig } from "@/e2e/config";
import { isFreshOwnedPayStateUrl } from "@/e2e/referrals/checkout";
import { isOwnedReferralCheckoutReviewUrl } from "@/e2e/referrals/checkout-review";
import { buildFreshCheckoutPayPath } from "@/features/checkout/backend/checkout/checkout-pay-url";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
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
  DiscountAffirmationUnavailableError,
  discountIdSchema,
  PromotionCodeUnavailableError,
} from "@/features/discounts";
import { calendarSaleDiscountServiceLayer } from "@/features/discounts/calendar-sale.test-utils";
import {
  type CanonicalPromotionCode,
  canonicalPromotionCodeSchema,
} from "@/features/discounts/contracts";
import type { ReferralService as ReferralServiceTag } from "@/features/referrals";
import { WithheldReferralService } from "@/features/referrals/referral.service.mock";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { getSlowestSuccessfulCalendarLoad } from "@/shared/backend/config/google-calendar.config.test-utils";
import {
  withActionDeadline,
  workspaceActionDeadline,
} from "@/shared/backend/workspace-action";
import { customerAgentNames } from "@/shared/bot-protection/customer-agents";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import { instantStringSchema } from "@/shared/utils/temporal";

mock.module("server-only", () => ({}));

// The browser remembers a different shared code than the one typed below.
mock.module("@/features/referrals/remembered-referral-code.server", () => ({
  readRememberedReferralCode: Effect.succeed("RFLREMEMBERED"),
  forgetRememberedReferralCode: async () => undefined,
}));

const payStateBookedAt = instantStringSchema.make("2026-06-01T09:58:00.000Z");

const reservation = {
  kind: "cowork" as const,
  entryTier: "basic" as const,
  coffee: false,
  date: "2026-08-04",
  name: "Ada Lovelace",
  email: testEmailAddress("ada"),
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
      bookedAt: payStateBookedAt,
      checkoutSessionId,
      requestedDiscountCode: input?.requestedDiscountCode,
    })
  );

  return await Effect.runPromise(sealPayState(state));
};

type SubmissionInput = {
  readonly submittedCode?: string;
  readonly applyDiscountCode?: ReturnType<typeof mock>;
  readonly acceptCode?: ReturnType<typeof mock>;
  readonly codeKind?: "referral" | "other";
  /** Replaces the mocked code-kind lookup. */
  readonly referralService?: Layer.Layer<ReferralServiceTag>;
  readonly payStateToken?: string;
  readonly activePaymentAttemptId?: string;
  readonly activePaymentAttemptIdAfterPricing?: string;
  readonly payableReservationUnavailableAt?: 1 | 2;
  readonly requestedDiscountCode?: CanonicalPromotionCode;
  /** How long each live payable-reservation guard takes. */
  readonly requireCurrentDuration?: Duration.Input;
  readonly verifyHuman?: ReturnType<typeof mock>;
  /** Replaces the pricing stub, for example with real pricing. */
  readonly pricing?: Layer.Layer<CheckoutPricingService>;
};

const prepareSubmission = async (input?: SubmissionInput) => {
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
  const verifyHuman = input?.verifyHuman ?? mock(() => Effect.void);
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
  const requireCurrent = mock(() =>
    Effect.sleep(input?.requireCurrentDuration ?? 0).pipe(
      Effect.andThen(() => {
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
      })
    )
  );
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
  const effect = applyDiscountCodeToPayState({
    locale: "en-US",
    payStateToken,
    submittedCode: input?.submittedCode ?? " save20 ",
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        BotProtectionServiceMock({ verifyHuman }),
        input?.pricing ?? CheckoutPricingServiceMock({ applyDiscountCode }),
        Layer.succeed(PayableReservationService, { requireCurrent }),
        input?.referralService ??
          Layer.succeed(ReferralService, { lookupCodeKind } as never),
        Layer.succeed(CheckoutReferralService, { acceptCode } as never)
      )
    )
  );

  return {
    applyDiscountCode,
    acceptCode,
    lookupCodeKind,
    effect,
    requireCurrent,
    payStateToken,
    verifyHuman,
  };
};

const runSubmission = async (input?: SubmissionInput) => {
  const { effect, ...submission } = await prepareSubmission(input);
  return { ...submission, result: await Effect.runPromise(effect) };
};

/** Runs a submission under an action deadline on an instant test clock. */
const runSubmissionWithinDeadline = async (
  deadline: Duration.Input,
  input?: SubmissionInput
) => {
  const { effect } = await prepareSubmission(input);
  return await effect.pipe(
    withActionDeadline(deadline),
    Effect.exit,
    withInstantSleeps,
    Effect.runPromise
  );
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
          referralCode: canonicalPromotionCodeSchema.make("RFL12345"),
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
      expect.objectContaining({
        submittedCode: "SAVE20",
        referralCode: "RFL12345",
      })
    );
    if (ordinary.result.status !== "applied") {
      throw new Error("Expected applied ordinary code");
    }
    const ordinaryState = await Effect.runPromise(
      openPayState(
        new URL(
          ordinary.result.freshPayUrl,
          "https://deskohub.test"
        ).searchParams.get(payStateTokenQueryParam) ?? ""
      )
    );
    expect(ordinaryState.referralCode).toBe("RFL12345");
  });

  test.each([
    ["unavailable", "unavailable"],
    ["already_attributed", "referral-already-attributed"],
    ["ineligible", "referral-ineligible"],
  ] as const)(
    "keeps a %s referral code in the box without promotion pricing",
    async (status, discountCodeError) => {
      const acceptCode = mock(() => Effect.succeed({ status }));
      const scenario = await runSubmission({
        submittedCode: "rfl12345",
        codeKind: "referral",
        acceptCode,
      });

      expect(scenario.result.status).toBe(status);
      expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
      expect(scenario.requireCurrent).not.toHaveBeenCalled();
      const freshPayUrl =
        "freshPayUrl" in scenario.result
          ? scenario.result.freshPayUrl
          : undefined;
      if (!freshPayUrl) throw new Error("Expected a replacement Pay URL");
      expect(freshPayUrl).not.toContain("RFL12345");
      const freshUrl = new URL(freshPayUrl, "https://deskohub.test");
      expect(freshUrl.searchParams.get("discountCodeError")).toBe(
        discountCodeError
      );
      expect(freshUrl.searchParams.get("discountCodeErrorId")).toBeTruthy();
      const freshState = await Effect.runPromise(
        openPayState(freshUrl.searchParams.get(payStateTokenQueryParam) ?? "")
      );
      expect(freshState.requestedDiscountCode).toBe("RFL12345");
      expect(freshState).not.toHaveProperty("referralCode");
      expect(freshState).not.toHaveProperty("submittedCode");
    }
  );

  test("seals a canonical code privately into a replacement pay state", async () => {
    const scenario = await runSubmission();

    expect(scenario.verifyHuman).toHaveBeenCalledWith({
      verificationFailurePolicy: "deny",
      verifiedBots: { allow: customerAgentNames },
      callSite: "checkout.apply-discount-code",
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
    expect(scenario.applyDiscountCode).toHaveBeenCalledWith(
      expect.objectContaining({
        bookedAt: Temporal.Instant.from(payStateBookedAt),
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

  test("returns automated_request before calling referral or pricing services", async () => {
    const { BotDetectedError } = await import(
      "@/shared/backend/bot-protection/bot-protection.service"
    );
    const verifyHuman = mock(() =>
      Effect.fail(
        new BotDetectedError({
          message: "Automated request detected",
          reason: "unverified_bot",
        })
      )
    );
    const scenario = await runSubmission({ verifyHuman });

    expect(scenario.result).toEqual({ status: "automated_request" });
    expect(verifyHuman).toHaveBeenCalledWith({
      verificationFailurePolicy: "deny",
      verifiedBots: { allow: customerAgentNames },
      callSite: "checkout.apply-discount-code",
    });
    expect(scenario.lookupCodeKind).not.toHaveBeenCalled();
    expect(scenario.acceptCode).not.toHaveBeenCalled();
    expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
    expect(scenario.requireCurrent).not.toHaveBeenCalled();
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
  });

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

  test("rejects a referral code exactly like an unknown code while referrals are withheld", async () => {
    // The ordinary code path finds no discount or voucher behind a referral
    // registry row, as PromotionCodeRepository.findByCode pins.
    const unknownCode = () =>
      mock(() =>
        Effect.fail(
          new PromotionCodeUnavailableError({
            reason: "unknown_code",
            message: "The submitted promotion code does not exist.",
          })
        )
      );
    const submit = (submittedCode: string) =>
      runSubmission({
        submittedCode,
        referralService: WithheldReferralService,
        applyDiscountCode: unknownCode(),
      });
    const fieldOutcome = async (
      scenario: Awaited<ReturnType<typeof submit>>
    ) => {
      if (scenario.result.status !== "unavailable") {
        throw new Error("Expected unavailable result");
      }
      const freshUrl = new URL(
        scenario.result.freshPayUrl ?? "",
        "https://deskohub.test"
      );
      const freshState = await Effect.runPromise(
        openPayState(freshUrl.searchParams.get(payStateTokenQueryParam) ?? "")
      );
      return {
        discountCodeError: freshUrl.searchParams.get("discountCodeError"),
        requestedDiscountCode: freshState.requestedDiscountCode,
        referralCode: freshState.referralCode,
        submittedCode: freshState.submittedCode,
      };
    };

    const referral = await submit("RFL12345");
    const unknown = await submit("NOPE12345");

    expect(referral.acceptCode).not.toHaveBeenCalled();
    expect(referral.applyDiscountCode).toHaveBeenCalledWith(
      expect.objectContaining({ submittedCode: "RFL12345" })
    );
    expect(await fieldOutcome(referral)).toEqual({
      discountCodeError: "unavailable",
      requestedDiscountCode: "RFL12345",
      referralCode: undefined,
      submittedCode: undefined,
    });
    expect(await fieldOutcome(unknown)).toEqual({
      discountCodeError: "unavailable",
      requestedDiscountCode: "NOPE12345",
      referralCode: undefined,
      submittedCode: undefined,
    });
  });

  describe.each([
    // A slow successful Calendar retry between live guards that are slow but
    // well within the Dotypos timeout; together they just outlast the
    // ordinary 45-second deadline.
    ["production", "18 seconds"],
    ["preview", "8 seconds"],
  ] as const)(
    "in %s, with a Calendar load that succeeds on its retry",
    (deploymentEnvironment, liveGuardDuration) => {
      const submission = () => {
        const listEvents = mock((saleEvents: readonly GoogleCalendarEvent[]) =>
          Effect.sleep(
            getSlowestSuccessfulCalendarLoad(deploymentEnvironment)
          ).pipe(Effect.as(saleEvents))
        );
        return {
          listEvents,
          input: {
            requireCurrentDuration: liveGuardDuration,
            pricing: CheckoutPricingService.Default.pipe(
              Layer.provide(
                calendarSaleDiscountServiceLayer({
                  calendarId: `apply-code-deadline-${deploymentEnvironment}`,
                  firstDay: Temporal.PlainDate.from("2026-05-01"),
                  lastDay: Temporal.PlainDate.from("2026-09-30"),
                  labels: { "en-US": "Summer sale", "cs-CZ": "Letní sleva" },
                  products: [{ kind: "cowork" }],
                  listEvents,
                })
              )
            ),
          } satisfies SubmissionInput,
        };
      };

      test("completes discount-code entry within its deadline", async () => {
        const { input, listEvents } = submission();

        const { getApplyDiscountCodeDeadline } = await import(
          "./apply-discount-code-to-pay-state"
        );

        const exit = await runSubmissionWithinDeadline(
          getApplyDiscountCodeDeadline(deploymentEnvironment),
          input
        );

        expect(listEvents).toHaveBeenCalledTimes(1);
        expect(exit._tag).toBe("Success");
      });

      test("would be interrupted under the ordinary action deadline", async () => {
        const exit = await runSubmissionWithinDeadline(
          workspaceActionDeadline,
          submission().input
        );

        expect(exit).toMatchObject({
          _tag: "Failure",
          cause: {
            reasons: [
              { error: { message: "Request timed out. Please try again." } },
            ],
          },
        });
      });
    }
  );

  test("keeps the existing summary payable when displayed discounts cannot be affirmed", async () => {
    const applyDiscountCode = mock(() =>
      Effect.fail(
        new DiscountAffirmationUnavailableError({
          message: "Calendar was unavailable.",
          discountIds: [submittedCodeDiscountId],
        })
      )
    );
    const scenario = await runSubmission({ applyDiscountCode });

    expect(scenario.result).toEqual({
      status: "unavailable",
      freshPayUrl: undefined,
    });
    expect(applyDiscountCode).toHaveBeenCalledTimes(1);
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
