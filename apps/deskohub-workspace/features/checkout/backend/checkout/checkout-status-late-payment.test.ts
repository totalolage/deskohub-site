import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { LatePaymentRecoveryState } from "@/db/schema";
import { SeatingMapFeatureFlagServiceMock } from "@/features/feature-flags/backend/seating-map-feature-flag.service.mock";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { LatePaymentVerificationService } from "../payment/late-payment-verification.service";
import { ProviderPaymentFinalizationService } from "../payment/provider-payment-finalization.service";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import { PaymentAttemptRepository } from "../repositories/payment-attempt.repository";
import { CheckoutStatusService } from "./checkout-status.service";

const instant = (value: string) => Temporal.Instant.from(value);

const reservationFixture = {
  id: "late-reservation",
  correlationId: "correlation-id",
  dotyposCustomerId: "customer-id",
  dotyposReservationId: "dotypos-original",
  reservationDetails: {
    kind: "cowork",
    entryTier: "open-space",
    coffee: false,
  },
  locale: "en-US",
  reservationState: "cancelled",
  paymentState: "expired",
  fulfillmentState: "not_started",
  activePaymentAttemptId: "late-attempt",
  failureCode: null,
  createdAt: instant("2026-06-01T10:00:00Z"),
  updatedAt: instant("2026-06-01T10:00:00Z"),
};

const paidAttempt = {
  id: "late-attempt",
  workspaceReservationId: "late-reservation",
  provider: "nexi",
  providerOrderId: "provider-order-id",
  state: "paid",
  refundState: "required",
  amount: { value: 29_000, exponent: 2, currency: "CZK" },
  createdAt: instant("2026-06-01T10:00:00Z"),
  updatedAt: instant("2026-06-01T10:00:00Z"),
};

const tables = [
  {
    _cloudId: "cloud-id",
    display: true,
    enabled: true,
    id: "open-table",
    name: "9",
    locationName: "Open space",
    tags: ["cowork:open-space"],
  },
];

const makeHarness = (options: {
  readonly reservation?: Partial<typeof reservationFixture>;
  readonly recovery?: {
    readonly state: LatePaymentRecoveryState;
    readonly paymentAttemptId?: string;
  };
  readonly finalizationResult?: "not_pending" | "paid" | "pending";
}) => {
  const startRecoveryIfSettled = mock(() =>
    Effect.succeed("recovery_started" as const)
  );
  const layer = CheckoutStatusService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProviderPaymentFinalizationService, {
          finalizePendingProviderPayment: mock(() =>
            Effect.succeed(options.finalizationResult ?? "not_pending")
          ),
        }),
        Layer.mock(WorkspaceReservationRepository, {
          findById: mock(() =>
            Effect.succeed({
              ...reservationFixture,
              ...options.reservation,
            } as never)
          ),
        }),
        Layer.mock(PaymentAttemptRepository, {
          findDisplayableForReservation: mock(() =>
            Effect.succeed(paidAttempt as never)
          ),
        }),
        Layer.mock(LatePaymentRecoveryRepository, {
          findLatestByWorkspaceReservationId: mock(() =>
            Effect.succeed(
              (options.recovery
                ? {
                    paymentAttemptId: "late-attempt",
                    workspaceReservationId: "late-reservation",
                    ...options.recovery,
                  }
                : null) as never
            )
          ),
        }),
        Layer.mock(LatePaymentVerificationService, { startRecoveryIfSettled }),
        Layer.mock(DotyposService, {
          getReservation: mock(() =>
            Effect.succeed({
              reservation: {
                id: "dotypos-original",
                _customerId: "customer-id",
                _tableId: "open-table",
                startDate: "2026-06-20T00:00:00.000+02:00",
                endDate: "2026-06-20T17:00:00.000+02:00",
                seats: "1",
                status: "CANCELLED",
              },
              customer: { id: "customer-id", email: "late@example.test" },
            } as never)
          ),
          getTables: mock(() => Effect.succeed(tables as never)),
        }),
        SeatingMapFeatureFlagServiceMock({ isEnabled: Effect.succeed(true) })
      )
    )
  );
  const getStatus = () =>
    Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.getStatus({
        orderId: "late-reservation" as never,
        returnOutcome: "success",
      });
    }).pipe(Effect.provide(layer), Effect.runPromise);
  const refreshStatus = () =>
    Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.refreshStatus({
        orderId: "late-reservation" as never,
        returnOutcome: "success",
      });
    }).pipe(Effect.provide(layer), Effect.runPromise);
  return { getStatus, refreshStatus, startRecoveryIfSettled };
};

const refundedReservation = {
  paymentState: "paid",
  fulfillmentState: "not_started",
  failureCode: "late_payment_reservation_unavailable",
};

describe("CheckoutStatusService for late payments", () => {
  test("tells the customer a late payment that needs a refund will be refunded", async () => {
    const status = await makeHarness({
      reservation: refundedReservation,
      recovery: { state: "refund_required" },
    }).getStatus();

    expect(status.status).toBe("late_payment_refund");
    expect(status.status).not.toBe("paid_waiting_fulfillment");
    expect(status).not.toHaveProperty("table");
    expect(status).not.toHaveProperty("tableMap");
  });

  for (const state of ["pending", "processing"] as const) {
    test(`shows a ${state} late-payment recovery as being checked`, async () => {
      const status = await makeHarness({
        recovery: { state },
      }).getStatus();

      expect(status.status).toBe("late_payment_checking");
      expect(status).not.toHaveProperty("tableMap");
    });
  }

  test("shows a late payment awaiting operator review truthfully", async () => {
    const status = await makeHarness({
      reservation: { paymentState: "paid" },
      recovery: { state: "review_required" },
    }).getStatus();

    expect(status.status).toBe("late_payment_review");
    expect(status).toMatchObject({
      supportContactPrefill: { email: "late@example.test" },
    });
  });

  test("does not prefill support contact for a refund the customer need not chase", async () => {
    const status = await makeHarness({
      reservation: refundedReservation,
      recovery: { state: "refund_required" },
    }).getStatus();

    expect(status).toMatchObject({ supportContactPrefill: undefined });
  });

  test("shows a recovered late payment as an ordinary confirmed reservation", async () => {
    const status = await makeHarness({
      reservation: {
        reservationState: "confirmed",
        paymentState: "paid",
        fulfillmentState: "fulfilled",
      },
      recovery: { state: "recovered" },
    }).getStatus();

    expect(status.status).toBe("fulfilled");
  });

  test("keeps a reservation paid by its active attempt confirmed when a superseded attempt needs a refund", async () => {
    const status = await makeHarness({
      reservation: {
        reservationState: "confirmed",
        paymentState: "paid",
        fulfillmentState: "fulfilled",
      },
      recovery: { state: "refund_required", paymentAttemptId: "old-attempt" },
    }).getStatus();

    expect(status.status).toBe("fulfilled");
  });

  test("shows a refund for a superseded attempt when the reservation was not otherwise paid", async () => {
    const status = await makeHarness({
      reservation: { paymentState: "expired" },
      recovery: { state: "refund_required", paymentAttemptId: "old-attempt" },
    }).getStatus();

    expect(status.status).toBe("late_payment_refund");
  });

  test("verifies a terminal attempt with the provider on refresh", async () => {
    const harness = makeHarness({ finalizationResult: "not_pending" });

    await harness.refreshStatus();

    expect(harness.startRecoveryIfSettled).toHaveBeenCalledWith({
      orderId: "late-reservation",
    });
  });

  test("does not look for a late payment while the payment is still pending", async () => {
    const harness = makeHarness({ finalizationResult: "pending" });

    await harness.refreshStatus();

    expect(harness.startRecoveryIfSettled).not.toHaveBeenCalled();
  });
});
