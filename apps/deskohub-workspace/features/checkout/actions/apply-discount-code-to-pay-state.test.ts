import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type { GoogleCalendarEvent } from "@deskohub/google-calendar";
import { testEmailAddress } from "@deskohub/test-email";
import { type Duration, Effect, Layer, Schema } from "effect";
import { SqlError } from "effect/unstable/sql";
import type { WorkspaceE2EConfig } from "@/e2e/config";
import { isFreshOwnedPayStateUrl } from "@/e2e/referrals/checkout";
import { isOwnedReferralCheckoutReviewUrl } from "@/e2e/referrals/checkout-review";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import {
  buildFreshCheckoutPayPath,
  getPayStateExpiresAt,
} from "@/features/checkout/backend/checkout/checkout-pay-url";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { CheckoutPricingServiceMock } from "@/features/checkout/backend/checkout/checkout-pricing.service.mock";
import {
  buildSignedPayState,
  openPayState,
  PayStateTokenError,
  payStateTokenQueryParam,
  sealPayState,
} from "@/features/checkout/backend/checkout/pay-state";
import { PayableReservationUnavailableError } from "@/features/checkout/backend/checkout/payable-reservation.service";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import type { CheckoutSummaryChangedKeys } from "@/features/checkout/checkout-summary";
import {
  DiscountAffirmationUnavailableError,
  DiscountProviderError,
  discountIdSchema,
  PromotionCodeUnavailableError,
} from "@/features/discounts";
import { calendarSaleDiscountServiceLayer } from "@/features/discounts/calendar-sale.test-utils";
import {
  type CanonicalPromotionCode,
  canonicalPromotionCodeSchema,
} from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import type { ReferralService as ReferralServiceTag } from "@/features/referrals";
import { ReferralError } from "@/features/referrals/contracts";
import { WithheldReferralService } from "@/features/referrals/referral.service.mock";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { getSlowestSuccessfulCalendarLoad } from "@/shared/backend/config/google-calendar.config.test-utils";
import {
  SealedStateKeys,
  sealedStateKeyIdSchema,
} from "@/shared/backend/sealed-state-keys.service";
import {
  withActionDeadline,
  workspaceActionDeadline,
} from "@/shared/backend/workspace-action";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import { instantStringSchema } from "@/shared/utils/temporal";
import type { ApplyDiscountCodeResult } from "./apply-discount-code-to-pay-state";

mock.module("server-only", () => ({}));

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
  readonly locale?: Locale;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  /** A code the signed state already applied. */
  readonly submittedCode?: CanonicalPromotionCode;
}) => {
  const state = await Effect.runPromise(
    buildSignedPayState({
      locale: input?.locale ?? "en-US",
      reservation,
      quote,
      orderId: "reservation-id",
      bookedAt: payStateBookedAt,
      checkoutSessionId,
      requestedDiscountCode: input?.requestedDiscountCode,
      changedKeys: input?.changedKeys,
      ...(input?.submittedCode && {
        submittedCode: input.submittedCode,
        submittedCodeDiscountId,
      }),
    }).pipe(Effect.provide(TestSealedStateKeys))
  );

  return await Effect.runPromise(
    sealPayState(state).pipe(Effect.provide(TestSealedStateKeys))
  );
};

type SubmissionInput = {
  readonly submittedCode?: string;
  readonly applyDiscountCode?: ReturnType<typeof mock>;
  readonly acceptCode?: ReturnType<typeof mock>;
  readonly codeKind?: "referral" | "other";
  /** Replaces the code-kind lookup's result. */
  readonly lookupCodeKind?: ReturnType<typeof mock>;
  /** The Dotypos customer the payable reservation stores. */
  readonly dotyposCustomerId?: string;
  /** Replaces the mocked code-kind lookup. */
  readonly referralService?: Layer.Layer<ReferralServiceTag>;
  readonly payStateToken?: string;
  readonly activePaymentAttemptId?: string;
  readonly activePaymentAttemptIdAfterPricing?: string;
  readonly payableReservationUnavailableAt?: 1 | 2;
  readonly requestedDiscountCode?: CanonicalPromotionCode;
  /** How long each live payable-reservation guard takes. */
  readonly requireCurrentDuration?: Duration.Input;
  readonly rememberedReferralCode?: string;
  readonly rememberedReferralWritable?: boolean;
  /** Replaces the pricing stub, for example with real pricing. */
  readonly pricing?: Layer.Layer<CheckoutPricingService>;
  /**
   * Runs the real checkout referral acceptance over these referral and
   * pricing stubs instead of stubbing `acceptCode`.
   */
  readonly referralAcceptance?: {
    readonly evaluateCheckoutReferral: ReturnType<typeof mock>;
    readonly affirmForPayment: ReturnType<typeof mock>;
    /** The keys acceptance opens and seals with; the test ring by default. */
    readonly sealedStateKeys?: Layer.Layer<SealedStateKeys>;
  };
};

const prepareSubmission = async (input?: SubmissionInput) => {
  const [
    { applyDiscountCodeToPayState },
    { PayableReservationService },
    { CheckoutReferralService },
    { ReferralService },
  ] = await Promise.all([
    import("./apply-discount-code-to-pay-state"),
    import("@/features/checkout/backend/checkout/payable-reservation.service"),
    import("@/features/checkout/backend/checkout"),
    import("@/features/referrals"),
  ]);
  let payableReservationReadCount = 0;
  const getReservation = () => ({
    id: "reservation-id",
    dotyposCustomerId: input?.dotyposCustomerId ?? "customer-id",
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
  const lookupCodeKind =
    input?.lookupCodeKind ??
    mock(() => Effect.succeed({ kind: input?.codeKind ?? "other" } as const));
  const acceptCode =
    input?.acceptCode ??
    mock(() =>
      Effect.succeed({
        status: "accepted" as const,
        freshPayUrl: "/en-US/checkout/pay?payState=fresh",
      })
    );
  const rememberedReferralCookie = {
    value: input?.rememberedReferralCode,
  };
  const referralService = Layer.succeed(ReferralService, {
    lookupCodeKind,
  } as never);
  const contacts = Layer.mock(CustomerAccountContactService, {});
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
        input?.pricing ?? CheckoutPricingServiceMock({ applyDiscountCode }),
        Layer.succeed(PayableReservationService, { requireCurrent }),
        input?.referralService ?? referralService,
        input?.referralAcceptance === undefined
          ? Layer.succeed(CheckoutReferralService, { acceptCode } as never)
          : CheckoutReferralService.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(ReferralService, {
                    lookupCodeKind,
                    evaluateCheckoutReferral:
                      input.referralAcceptance.evaluateCheckoutReferral,
                  } as never),
                  CheckoutPricingServiceMock({
                    affirmForPayment: input.referralAcceptance.affirmForPayment,
                  }),
                  Layer.succeed(PayableReservationService, { requireCurrent }),
                  input.referralAcceptance.sealedStateKeys ??
                    TestSealedStateKeys
                )
              )
            ),
        TestSealedStateKeys,
        RememberedReferral.inMemory(rememberedReferralCookie, {
          writable: input?.rememberedReferralWritable,
        }).pipe(
          Layer.provide(
            Layer.mergeAll(
              ReferralReleaseGate.fromDecision(true),
              input?.referralService ?? referralService,
              contacts
            )
          )
        )
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
    rememberedReferralCookie,
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
  test.each(["accepted", "already_accepted"] as const)(
    "remembers a typed referral code once it is %s, replacing the stored one",
    async (status) => {
      const scenario = await runSubmission({
        submittedCode: " rfl12345 ",
        codeKind: "referral",
        rememberedReferralCode: "RFLSHARED",
        acceptCode: mock(() =>
          Effect.succeed({ status, freshPayUrl: "/fresh" })
        ),
      });

      expect(scenario.result.status).toBe(status);
      expect(scenario.rememberedReferralCookie.value).toBe("RFL12345");
    }
  );

  test.each(["already_attributed", "ineligible", "unavailable"] as const)(
    "keeps the stored code when a typed referral is %s",
    async (status) => {
      const scenario = await runSubmission({
        submittedCode: "RFL12345",
        codeKind: "referral",
        rememberedReferralCode: "RFLSHARED",
        acceptCode: mock(() => Effect.succeed({ status })),
      });

      expect(scenario.result.status).toBe(status);
      expect(scenario.rememberedReferralCookie.value).toBe("RFLSHARED");
    }
  );

  test.each(["applied", "pricing_changed"] as const)(
    "keeps the stored code when a typed code is not accepted as a referral: %s",
    async (status) => {
      const changedKeys = {
        sectionKeys: ["order", "total"],
        itemKeys: ["product:cowork:basic", "total:final"],
      };
      const scenario = await runSubmission({
        submittedCode: "SAVE20",
        codeKind: "other",
        rememberedReferralCode: "RFLSHARED",
        applyDiscountCode: mock(() =>
          Effect.succeed(
            status === "applied"
              ? {
                  kind: "cowork" as const,
                  reservation,
                  status,
                  submittedCodeDiscountId,
                  quote,
                }
              : {
                  kind: "cowork" as const,
                  reservation,
                  status,
                  quote,
                  changedKeys,
                }
          )
        ),
      });

      expect(scenario.result.status).toBe(status);
      expect(scenario.rememberedReferralCookie.value).toBe("RFLSHARED");
    }
  );

  test("returns an accepted referral when the cookie write fails", async () => {
    const scenario = await runSubmission({
      submittedCode: "RFL12345",
      codeKind: "referral",
      rememberedReferralCode: "RFLSHARED",
      rememberedReferralWritable: false,
      acceptCode: mock(() =>
        Effect.succeed({ status: "accepted" as const, freshPayUrl: "/fresh" })
      ),
    });

    expect(scenario.result).toEqual({
      status: "accepted",
      freshPayUrl: "/fresh",
    });
    expect(scenario.rememberedReferralCookie.value).toBe("RFLSHARED");
  });

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
      openPayState(acceptedToken ?? "").pipe(
        Effect.provide(TestSealedStateKeys)
      )
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
      ).pipe(Effect.provide(TestSealedStateKeys))
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
        openPayState(
          freshUrl.searchParams.get(payStateTokenQueryParam) ?? ""
        ).pipe(Effect.provide(TestSealedStateKeys))
      );
      expect(freshState.requestedDiscountCode).toBe("RFL12345");
      expect(freshState).not.toHaveProperty("referralCode");
      expect(freshState).not.toHaveProperty("submittedCode");
    }
  );

  test("seals a canonical code privately into a replacement pay state", async () => {
    const scenario = await runSubmission();

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
    const freshState = await Effect.runPromise(
      openPayState(freshToken ?? "").pipe(Effect.provide(TestSealedStateKeys))
    );
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
      reason: "code",
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
    const freshState = await Effect.runPromise(
      openPayState(freshToken ?? "").pipe(Effect.provide(TestSealedStateKeys))
    );
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
        openPayState(
          freshUrl.searchParams.get(payStateTokenQueryParam) ?? ""
        ).pipe(Effect.provide(TestSealedStateKeys))
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
            reasons: [{ error: { _tag: "WorkspaceActionTimeout" } }],
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
      reason: "provider",
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
    const freshState = await Effect.runPromise(
      openPayState(freshToken ?? "").pipe(Effect.provide(TestSealedStateKeys))
    );
    expect(freshState.checkoutSessionId).toBe(checkoutSessionId);
    expect(freshState.changedKeys).toEqual(changedKeys);
    expect(freshState.submittedCode).toBeUndefined();
    expect(freshState.requestedDiscountCode).toBe("SAVE20");
  });

  test("does not reprice after a payment attempt has become active", async () => {
    const scenario = await runSubmission({
      activePaymentAttemptId: "attempt-id",
    });

    expect(scenario.result).toEqual({
      status: "unavailable",
      reason: "checkout",
      checkoutReason: "payment_in_progress",
    });
    expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
  });

  test("discards a replacement summary when payment starts during repricing", async () => {
    const scenario = await runSubmission({
      activePaymentAttemptIdAfterPricing: "attempt-id",
    });

    expect(scenario.result).toEqual({
      status: "unavailable",
      reason: "checkout",
      checkoutReason: "payment_in_progress",
    });
    expect(scenario.applyDiscountCode).toHaveBeenCalledTimes(1);
    expect(scenario.requireCurrent).toHaveBeenCalledTimes(2);
  });

  test("does not reprice a reservation that is no longer payable", async () => {
    const scenario = await runSubmission({
      payableReservationUnavailableAt: 1,
    });

    expect(scenario.result).toEqual({
      status: "unavailable",
      reason: "checkout",
      checkoutReason: "not_current",
    });
    expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
    expect(scenario.requireCurrent).toHaveBeenCalledTimes(1);
  });

  test("discards repricing when the reservation stops being payable", async () => {
    const scenario = await runSubmission({
      payableReservationUnavailableAt: 2,
    });

    expect(scenario.result).toEqual({
      status: "unavailable",
      reason: "checkout",
      checkoutReason: "not_current",
    });
    expect(scenario.applyDiscountCode).toHaveBeenCalledTimes(1);
    expect(scenario.requireCurrent).toHaveBeenCalledTimes(2);
  });

  test("fails a pay state signed for another language without checking the code", async () => {
    const { effect, lookupCodeKind, requireCurrent } = await prepareSubmission({
      payStateToken: await makePayStateToken({ locale: "cs-CZ" }),
    });

    const error = await Effect.runPromise(Effect.flip(effect));

    expect(error).toBeInstanceOf(PayStateTokenError);
    expect(error).toMatchObject({ code: "invalid-token" });
    expect(lookupCodeKind).not.toHaveBeenCalled();
    expect(requireCurrent).not.toHaveBeenCalled();
  });

  test.each([
    [
      "changed keys",
      {
        changedKeys: {
          sectionKeys: ["total"],
          itemKeys: ["total:final"],
        },
      },
      "price_review_pending",
    ],
    [
      "an applied code",
      { submittedCode: canonicalPromotionCodeSchema.make("SAVE10") },
      "code_already_applied",
    ],
  ] as const)(
    "returns unavailable without checking the code when the pay state carries %s",
    async (_, payState, reason) => {
      const scenario = await runSubmission({
        payStateToken: await makePayStateToken(payState),
      });

      expect(scenario.result).toStrictEqual({
        status: "unavailable",
        reason,
        freshPayUrl: undefined,
      });
      expect(scenario.lookupCodeKind).not.toHaveBeenCalled();
      expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
    }
  );

  test("returns a referral's own pricing_changed replacement as is", async () => {
    const changed = {
      status: "pricing_changed" as const,
      freshPayUrl: "/en-US/checkout/pay?payState=changed",
    };
    const scenario = await runSubmission({
      submittedCode: "RFL12345",
      codeKind: "referral",
      rememberedReferralCode: "RFLSHARED",
      acceptCode: mock(() => Effect.succeed(changed)),
    });

    expect(scenario.result).toBe(changed);
    expect(scenario.rememberedReferralCookie.value).toBe("RFLSHARED");
    expect(scenario.requireCurrent).not.toHaveBeenCalled();
  });

  test("keeps a referral code in the box as unavailable when pricing changed without a replacement", async () => {
    const scenario = await runSubmission({
      submittedCode: "RFL12345",
      codeKind: "referral",
      acceptCode: mock(() =>
        Effect.succeed({ status: "pricing_changed" as const })
      ),
    });

    expect(scenario.result.status).toBe("unavailable");
    const freshUrl = new URL(
      ("freshPayUrl" in scenario.result && scenario.result.freshPayUrl) || "",
      "https://deskohub.test"
    );
    expect(freshUrl.searchParams.get("discountCodeError")).toBe("unavailable");
    const freshState = await Effect.runPromise(
      openPayState(
        freshUrl.searchParams.get(payStateTokenQueryParam) ?? ""
      ).pipe(Effect.provide(TestSealedStateKeys))
    );
    expect(freshState.requestedDiscountCode).toBe("RFL12345");
  });

  test("returns unavailable when the referral registry can't classify the code", async () => {
    const scenario = await runSubmission({
      lookupCodeKind: mock(() =>
        Effect.fail(
          new SqlError.SqlError({
            reason: new SqlError.UnknownError({
              cause: new Error("synthetic connection refused"),
              message: "synthetic connection refused",
              operation: "query",
            }),
          })
        )
      ),
    });

    expect(scenario.result).toStrictEqual({
      status: "unavailable",
      reason: "provider",
      freshPayUrl: undefined,
    });
    expect(scenario.acceptCode).not.toHaveBeenCalled();
    expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
  });

  test("returns unavailable without pricing when the stored customer identity is invalid", async () => {
    const scenario = await runSubmission({ dotyposCustomerId: "" });

    expect(scenario.result).toStrictEqual({
      status: "unavailable",
      reason: "provider",
      freshPayUrl: undefined,
    });
    expect(scenario.requireCurrent).toHaveBeenCalledTimes(1);
    expect(scenario.applyDiscountCode).not.toHaveBeenCalled();
  });

  test.each(["applied", "pricing_changed"] as const)(
    "returns the %s replacement's sealed token and expiry from the same seal as its URL",
    async (status) => {
      const applyDiscountCode = mock(() =>
        Effect.succeed(
          status === "applied"
            ? {
                kind: "cowork" as const,
                reservation,
                status,
                submittedCodeDiscountId,
                quote,
              }
            : {
                kind: "cowork" as const,
                reservation,
                status,
                quote,
                changedKeys: { sectionKeys: ["total"], itemKeys: [] },
              }
        )
      );
      const scenario = await runSubmission({ applyDiscountCode });

      expect(scenario.result.status).toBe(status);
      await expectReplacementFromOneSeal(scenario.result);
    }
  );

  test("returns a rejected code's replacement with its sealed token and the code reason", async () => {
    const scenario = await runSubmission({
      applyDiscountCode: mock(() =>
        Effect.fail(
          new PromotionCodeUnavailableError({
            reason: "unknown_code",
            message: "The submitted promotion code does not exist.",
          })
        )
      ),
    });

    expect(scenario.result).toMatchObject({
      status: "unavailable",
      reason: "code",
    });
    await expectReplacementFromOneSeal(scenario.result);
  });

  test.each([
    [{ status: "already_attributed" }, { status: "already_attributed" }],
    [{ status: "ineligible" }, { status: "ineligible" }],
    [
      { status: "unavailable", reason: "code" },
      { status: "unavailable", reason: "code" },
    ],
    [
      { status: "unavailable", reason: "provider" },
      { status: "unavailable", reason: "provider" },
    ],
    [
      { status: "unavailable", reason: "checkout", checkoutReason: "expired" },
      { status: "unavailable", reason: "checkout", checkoutReason: "expired" },
    ],
    // A price change the referral flow could not sign is unexpected.
    [
      { status: "pricing_changed" },
      { status: "unavailable", reason: "provider" },
    ],
  ] as const)(
    "keeps the referral outcome %o as %o with a replacement from one seal",
    async (referralResult, expected) => {
      const scenario = await runSubmission({
        submittedCode: "RFL12345",
        codeKind: "referral",
        acceptCode: mock(() => Effect.succeed(referralResult)),
      });

      expect(scenario.result).toMatchObject(expected);
      if ("checkoutReason" in expected) {
        expect(scenario.result).toHaveProperty(
          "checkoutReason",
          expected.checkoutReason
        );
      } else {
        expect(scenario.result).not.toHaveProperty("checkoutReason");
      }
      await expectReplacementFromOneSeal(scenario.result);
    }
  );

  test.each([
    [
      "the displayed discounts cannot be affirmed",
      () =>
        new DiscountAffirmationUnavailableError({
          message: "Calendar was unavailable.",
          discountIds: [],
        }),
    ],
    [
      "the discount provider is down",
      () =>
        new DiscountProviderError({
          reason: "provider_failure",
          message: "Dotypos was unavailable.",
        }),
    ],
  ] as const)(
    "reports a referral whose pricing fails because %s as a provider failure, never a price change",
    async (_, failure) => {
      const scenario = await runSubmission({
        submittedCode: "RFL12345",
        codeKind: "referral",
        referralAcceptance: {
          evaluateCheckoutReferral: mock(() =>
            Effect.succeed({
              kind: "eligible" as const,
              code: canonicalPromotionCodeSchema.make("RFL12345"),
            })
          ),
          affirmForPayment: mock(() => Effect.fail(failure())),
        },
      });

      expect(scenario.result).toMatchObject({
        status: "unavailable",
        reason: "provider",
      });
      await expectReplacementFromOneSeal(scenario.result);
    }
  );

  test.each([
    [
      "a referral store outage",
      () =>
        new SqlError.SqlError({
          reason: new SqlError.UnknownError({
            cause: new Error("synthetic connection refused"),
            message: "synthetic connection refused",
            operation: "query",
          }),
        }),
      "provider",
    ],
    [
      "an inactive referral code",
      () => new ReferralError({ reason: "unavailable" }),
      "code",
    ],
  ] as const)(
    "tells %s apart: a retry or a correction, without pricing",
    async (_, failure, reason) => {
      const affirmForPayment = mock(() =>
        Effect.succeed({ kind: "cowork" as const, reservation, quote })
      );
      const scenario = await runSubmission({
        submittedCode: "RFL12345",
        codeKind: "referral",
        referralAcceptance: {
          evaluateCheckoutReferral: mock(() => Effect.fail(failure())),
          affirmForPayment,
        },
      });

      expect(scenario.result).toMatchObject({ status: "unavailable", reason });
      expect(affirmForPayment).not.toHaveBeenCalled();
      await expectReplacementFromOneSeal(scenario.result);
    }
  );

  test("neither evaluates nor reprices a referral once a payment attempt is active", async () => {
    const evaluateCheckoutReferral = mock(() =>
      Effect.succeed({
        kind: "eligible" as const,
        code: canonicalPromotionCodeSchema.make("RFL12345"),
      })
    );
    const affirmForPayment = mock(() =>
      Effect.succeed({ kind: "cowork" as const, reservation, quote })
    );
    const scenario = await runSubmission({
      submittedCode: "RFL12345",
      codeKind: "referral",
      activePaymentAttemptId: "attempt-id",
      referralAcceptance: { evaluateCheckoutReferral, affirmForPayment },
    });

    expect(scenario.result).toStrictEqual({
      status: "unavailable",
      reason: "checkout",
      checkoutReason: "payment_in_progress",
      freshPayUrl: undefined,
    });
    expect(evaluateCheckoutReferral).not.toHaveBeenCalled();
    expect(affirmForPayment).not.toHaveBeenCalled();
  });

  test("discards a referral repricing when a payment attempt starts meanwhile", async () => {
    const affirmForPayment = mock(() =>
      Effect.succeed({ kind: "cowork" as const, reservation, quote })
    );
    const scenario = await runSubmission({
      submittedCode: "RFL12345",
      codeKind: "referral",
      activePaymentAttemptIdAfterPricing: "attempt-id",
      referralAcceptance: {
        evaluateCheckoutReferral: mock(() =>
          Effect.succeed({
            kind: "eligible" as const,
            code: canonicalPromotionCodeSchema.make("RFL12345"),
          })
        ),
        affirmForPayment,
      },
    });

    expect(scenario.result).toStrictEqual({
      status: "unavailable",
      reason: "checkout",
      checkoutReason: "payment_in_progress",
      freshPayUrl: undefined,
    });
    expect(affirmForPayment).toHaveBeenCalledTimes(1);
    expect(scenario.requireCurrent).toHaveBeenCalledTimes(2);
  });

  test("reports a referral whose replacement checkout can't be sealed as a provider failure, never a price change", async () => {
    const testKeys = Effect.runSync(
      SealedStateKeys.pipe(Effect.provide(TestSealedStateKeys))
    );
    // The client's token still opens under its own key; the replacement is
    // sealed under the first key, which is too short for AES-256.
    const unsealableKeys = Layer.succeed(SealedStateKeys, {
      ...testKeys,
      ring: [
        { kid: sealedStateKeyIdSchema.make("broken"), key: Buffer.alloc(5) },
        ...testKeys.ring,
      ],
    });
    const acceptReferral = (sealedStateKeys: Layer.Layer<SealedStateKeys>) =>
      runSubmission({
        submittedCode: "RFL12345",
        codeKind: "referral",
        referralAcceptance: {
          evaluateCheckoutReferral: mock(() =>
            Effect.succeed({
              kind: "eligible" as const,
              code: canonicalPromotionCodeSchema.make("RFL12345"),
            })
          ),
          affirmForPayment: mock(() =>
            Effect.succeed({ kind: "cowork" as const, reservation, quote })
          ),
          sealedStateKeys,
        },
      });

    const sealed = await acceptReferral(TestSealedStateKeys);
    const unsealed = await acceptReferral(unsealableKeys);

    expect(sealed.result.status).toBe("accepted");
    expect(unsealed.result).toMatchObject({
      status: "unavailable",
      reason: "provider",
    });
  });

  test("reports an ordinary code whose provider is down as a provider failure", async () => {
    const scenario = await runSubmission({
      applyDiscountCode: mock(() =>
        Effect.fail(
          new DiscountProviderError({
            reason: "provider_failure",
            message: "Dotypos was unavailable.",
          })
        )
      ),
    });

    expect(scenario.result).toStrictEqual({
      status: "unavailable",
      reason: "provider",
      freshPayUrl: undefined,
    });
  });
});

/**
 * The result's replacement URL, sealed token and expiry all come from one
 * seal: the token is the URL's and the expiry is that state's.
 */
const expectReplacementFromOneSeal = async (
  replacement: ApplyDiscountCodeResult
) => {
  if (!replacement.freshPayUrl) throw new Error("Expected a replacement URL");
  const urlToken = new URL(
    replacement.freshPayUrl,
    "https://deskohub.test"
  ).searchParams.get(payStateTokenQueryParam);
  expect(urlToken).toBeTruthy();
  expect(replacement.freshPayStateToken).toBe(urlToken ?? "missing");
  const replacementState = await Effect.runPromise(
    openPayState(urlToken ?? "").pipe(Effect.provide(TestSealedStateKeys))
  );
  expect(replacement.expiresAt).toBe(getPayStateExpiresAt(replacementState));
};
