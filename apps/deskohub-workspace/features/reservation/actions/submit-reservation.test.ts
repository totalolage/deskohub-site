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
  readonly locale?: "cs-CZ" | "en-US";
  readonly verifyHuman?: ReturnType<typeof mock>;
  readonly createHostedPaymentCheckout?: ReturnType<typeof mock>;
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

  const verifyHuman = options?.verifyHuman ?? mock(() => Effect.void);
  const createHostedPaymentCheckout =
    options?.createHostedPaymentCheckout ??
    mock(() =>
      Effect.succeed({
        status: "redirect" as const,
        redirectUrl: "https://payments.example.test/checkout",
      })
    );

  const effect = submitWorkspaceReservation({
    ...input,
    locale: options?.locale ?? input.locale,
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        BotProtectionServiceMock({ verifyHuman }),
        Layer.succeed(CheckoutService, {
          createHostedPaymentCheckout,
        })
      )
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

  test("maps meeting-room availability failures from their typed cause", async () => {
    const { CheckoutError } = await import(
      "@/features/checkout/backend/checkout"
    );
    const { m } = await import("@/features/i18n");
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
            reservation: { kind: "meeting-room" },
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
      message: m.reservationMeetingRoomUnavailable({}, { locale: "en-US" }),
    });
  });

  test.each([
    "en-US",
    "cs-CZ",
  ] as const)("localizes an ended meeting-room reservation in %s", async (locale) => {
    const { CheckoutError } = await import(
      "@/features/checkout/backend/checkout"
    );
    const { m } = await import("@/features/i18n");
    const createHostedPaymentCheckout = mock(() =>
      Effect.fail(
        new CheckoutError({
          code: "meeting_room_reservation_ended",
          message: "internal diagnostic",
        })
      )
    );
    const scenario = await runSubmitReservation({
      createHostedPaymentCheckout,
      locale,
    });

    const error = await Effect.runPromise(Effect.flip(scenario.effect));

    expect(error).toMatchObject({
      _tag: "PublicSafeActionError",
      message: m.reservationValidationMeetingRoomEnded({}, { locale }),
    });
  });

  test.each([
    "en-US",
    "cs-CZ",
  ] as const)("localizes an ended office reservation in %s", async (locale) => {
    const { CheckoutError } = await import(
      "@/features/checkout/backend/checkout"
    );
    const { m } = await import("@/features/i18n");
    const createHostedPaymentCheckout = mock(() =>
      Effect.fail(
        new CheckoutError({
          code: "office_reservation_ended",
          message: "internal diagnostic",
        })
      )
    );
    const scenario = await runSubmitReservation({
      createHostedPaymentCheckout,
      locale,
    });

    const error = await Effect.runPromise(Effect.flip(scenario.effect));

    expect(error).toMatchObject({
      _tag: "PublicSafeActionError",
      message: m.reservationValidationOfficeEnded({}, { locale }),
    });
  });
});
