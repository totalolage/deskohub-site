import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

describe("reservation recovery input", () => {
  test("parses attach failure recovery records", async () => {
    const { parseReservationRecoveryInput } = await import(
      "@/features/checkout/backend/reservation-recovery.repository"
    );
    const cancellationAttemptedAt = new Date("2099-06-10T10:00:00.000Z");

    expect(
      parseReservationRecoveryInput({
        orderId: "order-id",
        reservationSubmitKey: "reservation-submit-key",
        dotyposCustomerId: "customer-id",
        dotyposReservationId: "reservation-id",
        attemptedCancellationResult: "cancelled",
        cancellationAttemptedAt,
        failureReason: "local attach failed",
      })
    ).toEqual({
      orderId: "order-id",
      reservationSubmitKey: "reservation-submit-key",
      dotyposCustomerId: "customer-id",
      dotyposReservationId: "reservation-id",
      attemptedCancellationResult: "cancelled",
      cancellationAttemptedAt,
      failureReason: "local attach failed",
    });
  });

  test("requires operational recovery identifiers", async () => {
    const { parseReservationRecoveryInput } = await import(
      "@/features/checkout/backend/reservation-recovery.repository"
    );

    expect(() =>
      parseReservationRecoveryInput({
        reservationSubmitKey: "",
        dotyposCustomerId: "customer-id",
        dotyposReservationId: "reservation-id",
        failureReason: "local attach failed",
      })
    ).toThrow();
  });
});
