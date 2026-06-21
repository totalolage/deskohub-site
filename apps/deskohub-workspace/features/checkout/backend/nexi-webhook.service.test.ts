import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type {
  NexiService as NexiServiceType,
  PaymentVerificationResult,
} from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import type { WorkspacePaidFulfillmentService as WorkspacePaidFulfillmentServiceType } from "@/features/checkout/backend/paid-fulfillment.service";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "@/features/checkout/backend/payment-attempt.repository";
import type { ReservationHoldCleanupService as ReservationHoldCleanupServiceType } from "@/features/checkout/backend/reservation-hold-cleanup.service";
import type { WebhookEventRepository as WebhookEventRepositoryType } from "@/features/checkout/backend/webhook-event.repository";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";

const payload = {
  eventId: "event-id",
  securityToken: "security-token",
  operation: {
    orderId: "provider-order-id",
    operationId: "operation-id",
    operationType: "CAPTURE",
    operationResult: "EXECUTED",
    operationAmount: "35000",
    operationCurrency: "CZK",
  },
};

const attempt = {
  id: "attempt-id",
  workspaceReservationId: "reservation-id",
  provider: "nexi" as const,
  providerOrderId: "provider-order-id",
  state: "pending" as const,
  amountValue: 35_000,
  amountExponent: 2,
  currency: "CZK",
  securityToken: "security-token",
  providerRedirectUrl: "https://provider.example/pay",
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const reservation = {
  id: "reservation-id",
  correlationId: "correlation-id",
};

const verification: PaymentVerificationResult = {
  status: "success",
  provider: {
    orderId: "provider-order-id",
    operationId: "operation-id",
    amount: "35000",
    currency: "CZK",
    orderStatus: "EXECUTED",
    captureExecuted: true,
  },
  mismatches: [],
};

const receivedEvent = {
  id: "webhook-row-id",
  provider: "nexi" as const,
  eventId: "event-id",
  paymentAttemptId: null,
  providerOrderId: "provider-order-id",
  receivedAt: new Date(),
  processedAt: null,
  state: "received" as const,
  errorCode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

type NexiWebhookTestServices = {
  readonly webhookEvents: WebhookEventRepositoryType;
  readonly paymentAttempts: PaymentAttemptRepositoryType;
  readonly reservations: WorkspaceReservationRepositoryType;
  readonly nexi: NexiServiceType;
  readonly fulfillment: WorkspacePaidFulfillmentServiceType;
};

const buildWebhookEffect = async (services: NexiWebhookTestServices) => {
  const { NexiService } = await import("@deskohub/nexi");
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { PostHogEventService } = await import(
    "@/shared/backend/analytics/posthog-event.service"
  );
  const { NexiWebhookService, NexiWebhookServiceLive } = await import(
    "./nexi-webhook.service"
  );
  const { PaymentAttemptRepository } = await import(
    "./payment-attempt.repository"
  );
  const { WorkspacePaidFulfillmentService } = await import(
    "./paid-fulfillment.service"
  );
  const { ReservationHoldCleanupService } = await import(
    "./reservation-hold-cleanup.service"
  );
  const { WebhookEventRepository } = await import("./webhook-event.repository");

  return Effect.gen(function* () {
    const service = yield* NexiWebhookService;
    return yield* service.processNotification(payload);
  }).pipe(
    Effect.provide(NexiWebhookServiceLive),
    Effect.provide(
      Layer.succeed(WebhookEventRepository, services.webhookEvents)
    ),
    Effect.provide(
      Layer.succeed(PaymentAttemptRepository, services.paymentAttempts)
    ),
    Effect.provide(
      Layer.succeed(WorkspaceReservationRepository, services.reservations)
    ),
    Effect.provide(
      Layer.succeed(ReservationHoldCleanupService, {
        cancelOrderHold: mock(() => Effect.die("unused")),
        sweepExpiredHolds: mock(() => Effect.die("unused")),
      } as unknown as ReservationHoldCleanupServiceType)
    ),
    Effect.provide(Layer.succeed(NexiService, services.nexi)),
    Effect.provide(
      Layer.succeed(WorkspacePaidFulfillmentService, services.fulfillment)
    ),
    Effect.provide(
      Layer.succeed(PostHogEventService, { capture: mock(() => Effect.void) })
    )
  );
};

describe("NexiWebhookService", () => {
  test("links the attempt, verifies, marks paid, fulfills, and marks processed", async () => {
    const linkPaymentAttempt = mock(() => Effect.void);
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);
    const markPaidForReservation = mock(() =>
      Effect.succeed({
        attempt: { ...attempt, state: "paid" as const },
        changed: true,
        timestamp: new Date(),
      })
    );
    const verifyPaymentOutcome = mock(() => Effect.succeed(verification));
    const fulfillPaidOrder = mock(() => Effect.void);

    const result = await Effect.runPromise(
      await buildWebhookEffect({
        webhookEvents: {
          insertReceived: mock(() =>
            Effect.succeed({ status: "inserted", event: receivedEvent })
          ),
          linkPaymentAttempt,
          markProcessed,
          markFailed,
          claimRetry: mock(() => Effect.die("unused")),
        } as unknown as WebhookEventRepositoryType,
        paymentAttempts: {
          findByProviderOrderId: mock(() => Effect.succeed(attempt)),
          markPaidForReservation,
          markTerminalForReservation: mock(() => Effect.die("unused")),
        } as unknown as PaymentAttemptRepositoryType,
        reservations: {
          findById: mock(() => Effect.succeed(reservation as never)),
        } as unknown as WorkspaceReservationRepositoryType,
        nexi: {
          verifyPaymentOutcome,
        } as unknown as NexiServiceType,
        fulfillment: {
          fulfillPaidOrder,
        } satisfies WorkspacePaidFulfillmentServiceType,
      })
    );

    expect(result).toEqual({
      status: "accepted",
      eventId: "event-id",
      orderId: "provider-order-id",
    });
    expect(linkPaymentAttempt).toHaveBeenCalledWith({
      type: "eventId",
      eventId: "event-id",
      paymentAttemptId: "attempt-id",
    });
    expect(verifyPaymentOutcome).toHaveBeenCalledWith({
      orderId: "provider-order-id",
      correlationId: "correlation-id",
      amount: "35000",
      currency: "CZK",
      securityToken: "security-token",
    });
    expect(markPaidForReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "attempt-id",
        workspaceReservationId: "reservation-id",
        webhookEventId: "event-id",
      })
    );
    expect(fulfillPaidOrder).toHaveBeenCalledWith({
      orderId: "reservation-id",
    });
    expect(markProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ type: "eventId", eventId: "event-id" })
    );
    expect(markFailed).not.toHaveBeenCalled();
  });

  test("marks the webhook failed and not processed when paid fulfillment fails", async () => {
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);

    const result = await Effect.runPromise(
      Effect.result(
        await buildWebhookEffect({
          webhookEvents: {
            insertReceived: mock(() =>
              Effect.succeed({ status: "inserted", event: receivedEvent })
            ),
            linkPaymentAttempt: mock(() => Effect.void),
            markProcessed,
            markFailed,
            claimRetry: mock(() => Effect.die("unused")),
          } as unknown as WebhookEventRepositoryType,
          paymentAttempts: {
            findByProviderOrderId: mock(() => Effect.succeed(attempt)),
            markPaidForReservation: mock(() =>
              Effect.succeed({
                attempt: { ...attempt, state: "paid" as const },
                changed: true,
                timestamp: new Date(),
              })
            ),
            markTerminalForReservation: mock(() => Effect.die("unused")),
          } as unknown as PaymentAttemptRepositoryType,
          reservations: {
            findById: mock(() => Effect.succeed(reservation as never)),
          } as unknown as WorkspaceReservationRepositoryType,
          nexi: {
            verifyPaymentOutcome: mock(() => Effect.succeed(verification)),
          } as unknown as NexiServiceType,
          fulfillment: {
            fulfillPaidOrder: mock(() =>
              Effect.fail(new Error("email failed"))
            ),
          } satisfies WorkspacePaidFulfillmentServiceType,
        })
      )
    );

    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Expected failure");
    expect(result.failure.errorCode).toBe("nexi_webhook_fulfillment_failed");
    expect(markFailed).toHaveBeenCalledWith({
      type: "eventId",
      eventId: "event-id",
      errorCode: "nexi_webhook_fulfillment_failed",
    });
    expect(markProcessed).not.toHaveBeenCalled();
  });
});
