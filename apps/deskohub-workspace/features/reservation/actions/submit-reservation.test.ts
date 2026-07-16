import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";

mock.module("server-only", () => ({}));

const input = {
  locale: "en-US" as const,
  payStateToken: "pay-state-token",
  legalConsent: true,
};

const runSubmitReservation = async (options?: {
  readonly verifyHuman?: ReturnType<typeof mock>;
  readonly createHostedPaymentCheckout?: ReturnType<typeof mock>;
}) => {
  const { CheckoutService } = await import(
    "@/features/checkout/backend/checkout"
  );
  const { submitWorkspaceReservation } = await import("./submit-reservation");
  const { BotProtectionServiceMock } = await import(
    "@/shared/backend/bot-protection/bot-protection.service.mock"
  );

  const verifyHuman = options?.verifyHuman ?? mock(() => Effect.void);
  const createHostedPaymentCheckout =
    options?.createHostedPaymentCheckout ??
    mock(() =>
      Effect.succeed({
        status: "redirect" as const,
        redirectUrl: "https://payments.example.test/checkout",
      })
    );

  const effect = submitWorkspaceReservation(input, {
    locale: "en-US",
  }).pipe(
    Effect.provide(BotProtectionServiceMock({ verifyHuman })),
    Effect.provide(
      Layer.succeed(CheckoutService, {
        createHostedPaymentCheckout,
      })
    )
  );

  return {
    effect,
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
    });
    expect(eventOrder).toEqual(["bot-verification", "checkout"]);
    expect(createHostedPaymentCheckout).toHaveBeenCalledWith(
      {
        payStateToken: input.payStateToken,
        legalConsent: true,
      },
      "en-US"
    );
    expect(result).toEqual({
      message: "Checkout started successfully",
      status: "redirect",
      redirectUrl: "https://payments.example.test/checkout",
    });
  });

  test("rejects a classified bot before creating checkout", async () => {
    const { BotDetectedError } = await import(
      "@/shared/backend/bot-protection/bot-protection.service"
    );
    const { m } = await import("@/features/i18n");
    const verifyHuman = mock(() =>
      Effect.fail(
        new BotDetectedError({ message: "Automated request detected" })
      )
    );
    const scenario = await runSubmitReservation({ verifyHuman });

    const error = await Effect.runPromise(Effect.flip(scenario.effect));

    expect(error).toMatchObject({
      _tag: "PublicSafeActionError",
      message: m.reservationRateLimitMessage({}, { locale: "en-US" }),
    });
    expect(scenario.createHostedPaymentCheckout).not.toHaveBeenCalled();
  });

  test("continues checkout when allow-policy verification is unavailable", async () => {
    const verificationCause = new Error("BotID unavailable");
    const verifyHuman = mock(
      ({ verificationFailurePolicy }: { verificationFailurePolicy: string }) =>
        verificationFailurePolicy === "allow"
          ? Effect.logWarning(
              "Workspace BotID verification failed; allowing request",
              { cause: verificationCause, verificationFailurePolicy }
            )
          : Effect.fail(verificationCause)
    );
    const scenario = await runSubmitReservation({ verifyHuman });

    await expect(Effect.runPromise(scenario.effect)).resolves.toMatchObject({
      status: "redirect",
    });
    expect(scenario.createHostedPaymentCheckout).toHaveBeenCalledTimes(1);
  });
});
