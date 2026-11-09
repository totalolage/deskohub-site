import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { customerAgentNames } from "@/shared/bot-protection/customer-agents";

mock.module("server-only", () => ({}));

let rememberedReferralCode: string | undefined;

const input = {
  locale: "en-US" as const,
  payStateToken: "pay-state-token",
  legalConsent: true,
  earlyPerformanceConsent: true,
};

const runSubmitReservation = async (options?: {
  readonly locale?: "cs-CZ" | "en-US";
  readonly verifyHuman?: ReturnType<typeof mock>;
  readonly createHostedPaymentCheckout?: ReturnType<typeof mock>;
  readonly bookerCustomerId?: string;
  readonly hasSettledReferral?: ReturnType<typeof mock>;
}) => {
  const { CheckoutService } = await import(
    "@/features/checkout/backend/checkout"
  );
  const { submitWorkspaceReservation } = await import(
    "./submit-workspace-reservation"
  );
  const { BotProtectionServiceMock } = await import(
    "@/shared/backend/bot-protection/bot-protection.service.mock"
  );
  const { CustomerAccountContactService } = await import("@/features/account");
  const { ReferralServiceMock } = await import(
    "@/features/referrals/referral.service.mock"
  );
  const hasSettledReferral =
    options?.hasSettledReferral ?? mock(() => Effect.succeed(false));
  const cookie = { value: rememberedReferralCode };

  const verifyHuman = options?.verifyHuman ?? mock(() => Effect.void);
  const createHostedPaymentCheckout =
    options?.createHostedPaymentCheckout ??
    mock(() =>
      Effect.succeed({
        status: "redirect" as const,
        redirectUrl: "https://payments.example.test/checkout",
        statusUrl: "/en-US/reservation/status/reservation-id",
      })
    );

  const contacts = Layer.mock(CustomerAccountContactService, {
    currentAccount: Effect.succeed(
      options?.bookerCustomerId === undefined
        ? ({ status: "signed-out" } as const)
        : ({
            status: "linked",
            accountId: "booker-account",
            dotyposCustomerId: options.bookerCustomerId,
          } as never)
    ),
  });
  const referrals = ReferralServiceMock({
    hasSettledReferral: hasSettledReferral as never,
  });
  const effect = submitWorkspaceReservation({
    ...input,
    locale: options?.locale ?? input.locale,
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        BotProtectionServiceMock({ verifyHuman }),
        Layer.succeed(CheckoutService, {
          createHostedPaymentCheckout,
        }),
        contacts,
        referrals,
        ReferralReleaseGate.fromDecision(true),
        RememberedReferral.inMemory(cookie).pipe(
          Layer.provide(
            Layer.mergeAll(
              ReferralReleaseGate.fromDecision(true),
              referrals,
              contacts
            )
          )
        )
      )
    )
  );

  return {
    effect,
    cookie,
    verifyHuman,
    createHostedPaymentCheckout,
  };
};

describe("submitWorkspaceReservation", () => {
  test("verifies with the allow policy before creating checkout", async () => {
    const eventOrder: string[] = [];
    const verifyHuman = mock(() =>
      Effect.sync(() => {
        eventOrder.push("bot-verification");
      })
    );
    const createHostedPaymentCheckout = mock(() =>
      Effect.sync(() => {
        eventOrder.push("checkout");
        return {
          status: "redirect" as const,
          redirectUrl: "https://payments.example.test/checkout",
          statusUrl: "/en-US/reservation/status/reservation-id",
        };
      })
    );
    const scenario = await runSubmitReservation({
      verifyHuman,
      createHostedPaymentCheckout,
    });

    const result = await Effect.runPromise(scenario.effect);

    expect(verifyHuman).toHaveBeenCalledWith({
      verificationFailurePolicy: "allow",
      verifiedBots: { allow: customerAgentNames },
      callSite: "reservation.submit",
    });
    expect(eventOrder).toEqual(["bot-verification", "checkout"]);
    expect(createHostedPaymentCheckout).toHaveBeenCalledWith(
      {
        payStateToken: input.payStateToken,
        legalConsent: true,
        earlyPerformanceConsent: true,
      },
      "en-US"
    );
    expect(result).toEqual({
      message: "Checkout started successfully",
      status: "redirect",
      redirectUrl: "https://payments.example.test/checkout",
      statusUrl: "/en-US/reservation/status/reservation-id",
    });
  });

  test.each([
    [
      "a hosted payment",
      {
        status: "redirect",
        orderId: "reservation-id",
        redirectUrl: "https://payments.example.test/checkout",
        statusUrl: "/en-US/reservation/status/reservation-id",
      },
      ["message", "redirectUrl", "status", "statusUrl"],
    ],
    [
      "a paid order",
      {
        status: "redirect",
        orderId: "reservation-id",
        redirectUrl: "/en-US/reservation/status/reservation-id",
        paid: true,
      },
      ["message", "paid", "redirectUrl", "status"],
    ],
    [
      "a changed price",
      {
        status: "pricing_changed",
        changedKeys: { sectionKeys: [], itemKeys: [] },
        freshSummary: { sections: [] },
        freshPayUrl: "/en-US/checkout/pay?payState=fresh",
        freshPayStateToken: "fresh-token",
        expiresAt: "2099-07-01T10:13:00.000Z",
      },
      ["changedKeys", "freshPayUrl", "freshSummary", "message", "status"],
    ],
    ["a payment in progress", { status: "in_progress" }, ["message", "status"]],
  ] as const)(
    "answers the Pay page %s without the API's checkout fields",
    async (_label, checkout, keys) => {
      const scenario = await runSubmitReservation({
        createHostedPaymentCheckout: mock(() => Effect.succeed(checkout)),
      });

      const result = await Effect.runPromise(scenario.effect);

      expect(Object.keys(result).toSorted()).toEqual([...keys]);
    }
  );

  test.each([
    [
      "zero-total",
      "/en-US/reservation/status/reservation-zero-total?outcome=success",
    ],
  ] as const)(
    "preserves the %s internal redirect when only redirectUrl is returned",
    async (_label, redirectUrl) => {
      const createHostedPaymentCheckout = mock(() =>
        Effect.succeed({
          status: "redirect" as const,
          redirectUrl,
        })
      );
      const scenario = await runSubmitReservation({
        createHostedPaymentCheckout,
      });

      await expect(Effect.runPromise(scenario.effect)).resolves.toEqual({
        message: "Checkout started successfully",
        status: "redirect",
        redirectUrl,
      });
    }
  );

  test.each(["zero-total"] as const)(
    "forgets the remembered referral code once the %s checkout is paid",
    async (label) => {
      rememberedReferralCode = "RFL12345";
      const redirectUrl = `/en-US/reservation/status/reservation-${label}?outcome=success`;
      const scenario = await runSubmitReservation({
        createHostedPaymentCheckout: mock(() =>
          Effect.succeed({
            status: "redirect" as const,
            redirectUrl,
            paid: true,
          })
        ),
      });

      await expect(Effect.runPromise(scenario.effect)).resolves.toEqual({
        message: "Checkout started successfully",
        status: "redirect",
        redirectUrl,
        paid: true,
      });
      expect(scenario.cookie.value).toBeUndefined();
    }
  );

  test.each([
    ["a settled friend keeps the booker's code", false, "RFL12345"],
    ["a settled booker clears the booker's code", true, undefined],
  ] as const)(
    "checks the signed-in booker's own customer after a paid checkout: %s",
    async (_label, bookerSettled, codeAfter) => {
      rememberedReferralCode = "RFL12345";
      const hasSettledReferral = mock(() => Effect.succeed(bookerSettled));
      const scenario = await runSubmitReservation({
        createHostedPaymentCheckout: mock(() =>
          Effect.succeed({
            status: "redirect" as const,
            redirectUrl: "/en-US/reservation/status/reservation-friend",
            paid: true,
          })
        ),
        bookerCustomerId: "booker-customer",
        hasSettledReferral,
      });

      await Effect.runPromise(scenario.effect);

      expect(hasSettledReferral.mock.calls).toEqual([
        [{ dotyposCustomerId: "booker-customer" }],
      ]);
      expect(scenario.cookie.value).toBe(codeAfter);
    }
  );

  test("keeps the remembered referral code while a hosted payment is pending", async () => {
    rememberedReferralCode = "RFL12345";
    const scenario = await runSubmitReservation();

    await Effect.runPromise(scenario.effect);

    expect(scenario.cookie.value).toBe("RFL12345");
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "rejects a classified bot before creating checkout in %s",
    async (locale) => {
      const { BotDetectedError } = await import(
        "@/shared/backend/bot-protection/bot-protection.service"
      );
      const { m } = await import("@/features/i18n");
      const verifyHuman = mock(() =>
        Effect.fail(
          new BotDetectedError({
            message: "Automated request detected",
            reason: "unverified_bot",
          })
        )
      );
      const scenario = await runSubmitReservation({ verifyHuman, locale });

      const error = await Effect.runPromise(Effect.flip(scenario.effect));

      expect(error).toMatchObject({
        _tag: "PublicSafeActionError",
        message: m.automatedRequestRejected({}, { locale }),
      });
      expect(scenario.createHostedPaymentCheckout).not.toHaveBeenCalled();
    }
  );

  test("maps cowork availability failures from their typed cause", async () => {
    const { CheckoutError } = await import(
      "@/features/checkout/backend/checkout"
    );
    const { getReservationAvailabilityUnavailableMessage } = await import(
      "@/features/reservation/reservation.i18n"
    );
    const { WorkspaceTableUnavailableError } = await import(
      "@/features/reservation/backend/workspace-availability.service"
    );
    const createHostedPaymentCheckout = mock(() =>
      Effect.fail(
        new CheckoutError({
          code: "checkout_failed",
          message: "workspace_table_unavailable",
          cause: new WorkspaceTableUnavailableError({
            date: "2099-07-30",
            reservation: { kind: "cowork", entryTier: "basic" },
          }),
        })
      )
    );
    const scenario = await runSubmitReservation({
      createHostedPaymentCheckout,
    });

    const error = await Effect.runPromise(Effect.flip(scenario.effect));

    expect(error).toMatchObject({
      _tag: "PublicSafeActionError",
      message: getReservationAvailabilityUnavailableMessage({
        date: "2099-07-30",
        locale: "en-US",
        reservation: { kind: "cowork", entryTier: "basic" },
      }),
    });
  });

  test.each([
    { code: "legal_consent_required", locale: "en-US" },
    { code: "early_performance_consent_required", locale: "en-US" },
    { code: "legal_consent_required", locale: "cs-CZ" },
    { code: "early_performance_consent_required", locale: "cs-CZ" },
  ] as const)(
    "shows the generic checkout failure for $code in $locale",
    async ({ code, locale }) => {
      const { CheckoutError } = await import(
        "@/features/checkout/backend/checkout"
      );
      const { m } = await import("@/features/i18n");
      const failSubmission = async (
        error: InstanceType<typeof CheckoutError>
      ) =>
        Effect.runPromise(
          Effect.flip(
            (
              await runSubmitReservation({
                locale,
                createHostedPaymentCheckout: mock(() => Effect.fail(error)),
              })
            ).effect
          )
        );

      const consentFailure = await failSubmission(
        new CheckoutError({ code, message: "Consent is required." })
      );
      const genericFailure = await failSubmission(
        new CheckoutError({
          code: "checkout_failed",
          message: "Checkout failed.",
        })
      );

      expect(consentFailure).toMatchObject({
        _tag: "PublicSafeActionError",
        message: m.reservationErrorMessage({}, { locale }),
      });
      expect(consentFailure.message).toBe(genericFailure.message);
    }
  );
});
