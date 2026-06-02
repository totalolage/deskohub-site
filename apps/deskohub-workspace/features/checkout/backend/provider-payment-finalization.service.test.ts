import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { NexiService as NexiServiceType } from "@deskohub/nexi";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "@/features/checkout/backend/payment-attempt.repository";
import type { WorkspacePaidFulfillmentService as WorkspacePaidFulfillmentServiceType } from "@/features/checkout/backend/paid-fulfillment.service";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/checkout/backend/workspace-reservation.repository";

const paidUnfulfilledReservation = {
  id: "reservation-id",
  correlationId: "correlation-id",
  paymentState: "paid",
  fulfillmentState: "failed",
  activePaymentAttemptId: "attempt-id",
};

describe("ProviderPaymentFinalizationService", () => {
  test("retries fulfillment for already-paid provider returns", async () => {
    const {
      ProviderPaymentFinalizationService,
      ProviderPaymentFinalizationServiceLive,
    } = await import("./provider-payment-finalization.service");
    const { PaymentAttemptRepository } = await import(
      "./payment-attempt.repository"
    );
    const { WorkspacePaidFulfillmentService } = await import(
      "./paid-fulfillment.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "./workspace-reservation.repository"
    );
    const { NexiService } = await import("@deskohub/nexi");

    const fulfillPaidOrder = mock(() => Effect.void);
    const reservations = {
      findById: mock(() => Effect.succeed(paidUnfulfilledReservation)),
    } as unknown as WorkspaceReservationRepositoryType;
    const fulfillment: WorkspacePaidFulfillmentServiceType = {
      fulfillPaidOrder,
    };

    const result = await Effect.gen(function* () {
      const service = yield* ProviderPaymentFinalizationService;
      return yield* service.finalizePendingProviderPayment({
        orderId: "reservation-id",
        paymentAttemptId: "attempt-id",
      });
    }).pipe(
      Effect.provide(ProviderPaymentFinalizationServiceLive),
      Effect.provide(
        Layer.succeed(WorkspaceReservationRepository, reservations)
      ),
      Effect.provide(Layer.succeed(WorkspacePaidFulfillmentService, fulfillment)),
      Effect.provide(
        Layer.succeed(PaymentAttemptRepository, {} as PaymentAttemptRepositoryType)
      ),
      Effect.provide(Layer.succeed(NexiService, {} as NexiServiceType)),
      Effect.runPromise
    );

    expect(result).toBe("paid");
    expect(fulfillPaidOrder).toHaveBeenCalledWith({ orderId: "reservation-id" });
  });
});
