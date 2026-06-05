import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type { NexiService as NexiServiceType } from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import type { WorkspacePaidFulfillmentService as WorkspacePaidFulfillmentServiceType } from "@/features/checkout/backend/paid-fulfillment.service";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "@/features/checkout/backend/payment-attempt.repository";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/checkout/backend/workspace-reservation.repository";

const paidNotStartedReservation = {
  id: "reservation-id",
  correlationId: "correlation-id",
  paymentState: "paid",
  fulfillmentState: "not_started",
  activePaymentAttemptId: "attempt-id",
};

describe("ProviderPaymentFinalizationService", () => {
  test("starts fulfillment for already-paid provider returns that were never fulfilled", async () => {
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
      findById: mock(() => Effect.succeed(paidNotStartedReservation)),
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
      Effect.provide(
        Layer.succeed(WorkspacePaidFulfillmentService, fulfillment)
      ),
      Effect.provide(
        Layer.succeed(
          PaymentAttemptRepository,
          {} as PaymentAttemptRepositoryType
        )
      ),
      Effect.provide(Layer.succeed(NexiService, {} as NexiServiceType)),
      Effect.runPromise
    );

    expect(result).toBe("paid");
    expect(fulfillPaidOrder).toHaveBeenCalledWith({
      orderId: "reservation-id",
    });
  });

  test("does not retry fulfillment after a paid reservation has failed fulfillment", async () => {
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
      findById: mock(() =>
        Effect.succeed({
          ...paidNotStartedReservation,
          fulfillmentState: "failed",
        })
      ),
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
      Effect.provide(
        Layer.succeed(WorkspacePaidFulfillmentService, fulfillment)
      ),
      Effect.provide(
        Layer.succeed(
          PaymentAttemptRepository,
          {} as PaymentAttemptRepositoryType
        )
      ),
      Effect.provide(Layer.succeed(NexiService, {} as NexiServiceType)),
      Effect.runPromise
    );

    expect(result).toBe("not_pending");
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
  });
});
