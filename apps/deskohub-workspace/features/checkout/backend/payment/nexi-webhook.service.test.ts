import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type {
  NexiService as NexiServiceTag,
  PaymentVerificationResult,
} from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import type { IOrderRepository } from "@/features/order/backend/order.repository";
import type { IWorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspacePaidFulfillmentError } from "../fulfillment/paid-fulfillment.service";
import type { IPaidOrderCompletionService } from "../fulfillment/paid-order-completion.service";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "../repositories/payment-attempt.repository";
import type { IPaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";
import type { IWebhookEventRepository as WebhookEventRepositoryType } from "../repositories/webhook-event.repository";

type NexiServiceType = typeof NexiServiceTag.Service;

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
  orderId: "reservation-id",
  workspaceReservationId: "reservation-id",
  provider: "nexi" as const,
  providerOrderId: "provider-order-id",
  state: "pending" as const,
  amount: {
    value: 35_000,
    exponent: 2,
    currency: "CZK",
  },
  securityToken: "security-token",
  providerRedirectUrl: "https://provider.example/pay",
  providerOrderCreatedAt: Temporal.Instant.from("2026-06-01T10:00:00Z"),
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  createdAt: Temporal.Now.instant(),
  updatedAt: Temporal.Now.instant(),
};

const order = {
  id: "reservation-id",
  kind: "reservation" as const,
  correlationId: "correlation-id",
  dotyposCustomerId: "customer-id",
  paymentState: "pending" as const,
  fulfillmentState: "not_started" as const,
  activePaymentAttemptId: "attempt-id",
  paidAt: null,
  fulfilledAt: null,
  fulfillmentFailedAt: null,
  fulfillmentFailureCode: null,
  createdAt: Temporal.Now.instant(),
  updatedAt: Temporal.Now.instant(),
};

const reservation = { id: "reservation-id", correlationId: "correlation-id" };

const verification: PaymentVerificationResult = {
  status: "success",
  provider: {
    orderId: "provider-order-id",
    operationId: "operation-id",
    operationCount: 1,
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
  receivedAt: Temporal.Now.instant(),
  processedAt: null,
  state: "received" as const,
  errorCode: null,
  createdAt: Temporal.Now.instant(),
  updatedAt: Temporal.Now.instant(),
};

type NexiWebhookTestServices = {
  readonly webhookEvents: WebhookEventRepositoryType;
  readonly paymentAttempts: PaymentAttemptRepositoryType;
  readonly paymentLifecycle: IPaymentLifecycleRepository;
  readonly orders: IOrderRepository;
  readonly reservations: WorkspaceReservationRepositoryType;
  readonly nexi: NexiServiceType;
  readonly completion: IPaidOrderCompletionService;
  readonly latePaymentRecoveries?: object;
  readonly latePaymentRecoveryQueue?: object;
};

const buildWebhookEffect = async (services: NexiWebhookTestServices) => {
  const { NexiService } = await import("@deskohub/nexi");
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { OrderRepository } = await import(
    "@/features/order/backend/order.repository"
  );
  const { PostHogEventService } = await import(
    "@/shared/backend/analytics/posthog-event.service"
  );
  const { NexiWebhookService } = await import("./nexi-webhook.service");
  const { PaymentAttemptRepository } = await import(
    "../repositories/payment-attempt.repository"
  );
  const { PaymentLifecycleRepository } = await import(
    "../repositories/payment-lifecycle.repository"
  );
  const { LatePaymentRecoveryRepository } = await import(
    "../repositories/late-payment-recovery.repository"
  );
  const { LatePaymentRecoveryQueueService } = await import(
    "./late-payment-recovery-queue.service"
  );
  const { PaidOrderCompletionService } = await import(
    "../fulfillment/paid-order-completion.service"
  );
  const { ReservationHoldCleanupService } = await import(
    "../holds/reservation-hold-cleanup.service"
  );
  const { WebhookEventRepository } = await import(
    "../repositories/webhook-event.repository"
  );

  return Effect.gen(function* () {
    const service = yield* NexiWebhookService;
    return yield* service.processNotification(payload);
  }).pipe(
    Effect.provide(
      NexiWebhookService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(WebhookEventRepository, services.webhookEvents),
            Layer.mock(PaymentAttemptRepository, services.paymentAttempts),
            Layer.mock(PaymentLifecycleRepository, services.paymentLifecycle),
            Layer.mock(OrderRepository, services.orders),
            Layer.mock(WorkspaceReservationRepository, services.reservations),
            Layer.mock(ReservationHoldCleanupService, {
              cancelOrderHold: mock(() => Effect.die("unused")),
              sweepExpiredHolds: mock(() => Effect.die("unused")),
            }),
            Layer.mock(NexiService, services.nexi),
            Layer.mock(PaidOrderCompletionService, services.completion),
            Layer.mock(LatePaymentRecoveryRepository, {
              start: mock(() => Effect.die("unused")),
              findByPaymentAttemptId: mock(() => Effect.die("unused")),
              claim: mock(() => Effect.die("unused")),
              hasNewerActiveReservation: mock(() => Effect.die("unused")),
              completeUsingOriginalReservation: mock(() =>
                Effect.die("unused")
              ),
              completeWithReplacement: mock(() => Effect.die("unused")),
              requireRefund: mock(() => Effect.die("unused")),
              requireReview: mock(() => Effect.die("unused")),
              ...services.latePaymentRecoveries,
            }),
            Layer.mock(LatePaymentRecoveryQueueService, {
              enqueue: mock(() => Effect.die("unused")),
              ...services.latePaymentRecoveryQueue,
            }),
            Layer.mock(PostHogEventService, {
              capture: mock(() => Effect.void),
            })
          )
        )
      )
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
        timestamp: Temporal.Now.instant(),
      })
    );
    const verifyPaymentOutcome = mock(() => Effect.succeed(verification));
    const complete = mock(() => Effect.void);

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
        },
        paymentAttempts: {
          findByProviderOrderId: mock(() => Effect.succeed(attempt)),
        },
        paymentLifecycle: {
          createPendingNexiAttempt: mock(() => Effect.die("unused")),
          attachProviderSession: mock(() => Effect.die("unused")),
          markPaid: markPaidForReservation,
          markTerminal: mock(() => Effect.die("unused")),
        },
        orders: {
          findById: mock(() => Effect.succeed(order)),
        },
        reservations: {
          findById: mock(() => Effect.succeed(reservation as never)),
        },
        nexi: {
          verifyPaymentOutcome,
        },
        completion: { complete },
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
      currency: "EUR",
      securityToken: "security-token",
    });
    expect(markPaidForReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "attempt-id",
        orderId: "reservation-id",
        webhookEventId: "event-id",
      })
    );
    expect(complete).toHaveBeenCalledWith({
      orderId: "reservation-id",
      kind: "reservation",
      paymentAttemptId: "attempt-id",
    });
    expect(markProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ type: "eventId", eventId: "event-id" })
    );
    expect(markFailed).not.toHaveBeenCalled();
  });

  test("queues recovery for a late successful payment without fulfilling", async () => {
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);
    const markPaidForReservation = mock(() => Effect.die("not used"));
    const complete = mock(() => Effect.die("not used"));
    const start = mock(() =>
      Effect.succeed({ paymentAttemptId: "attempt-id" } as never)
    );
    const enqueue = mock(() => Effect.void);

    const result = await Effect.runPromise(
      await buildWebhookEffect({
        webhookEvents: {
          insertReceived: mock(() =>
            Effect.succeed({ status: "inserted", event: receivedEvent })
          ),
          linkPaymentAttempt: mock(() => Effect.void),
          markProcessed,
          markFailed,
          claimRetry: mock(() => Effect.die("unused")),
        },
        paymentAttempts: {
          findByProviderOrderId: mock(() =>
            Effect.succeed({
              ...attempt,
              state: "expired" as const,
              failureCode: "payment_abandoned_after_provider_cutoff",
            })
          ),
        },
        paymentLifecycle: {
          createPendingNexiAttempt: mock(() => Effect.die("unused")),
          attachProviderSession: mock(() => Effect.die("unused")),
          markPaid: markPaidForReservation,
          markTerminal: mock(() => Effect.die("unused")),
        },
        orders: {
          findById: mock(() => Effect.succeed(order)),
        },
        reservations: {
          findById: mock(() => Effect.succeed(reservation as never)),
        },
        nexi: {
          verifyPaymentOutcome: mock(() => Effect.succeed(verification)),
        },
        completion: { complete },
        latePaymentRecoveries: { start },
        latePaymentRecoveryQueue: { enqueue },
      })
    );

    expect(result).toEqual({
      status: "accepted",
      eventId: "event-id",
      orderId: "provider-order-id",
    });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentAttemptId: "attempt-id",
        workspaceReservationId: "reservation-id",
        webhookEventId: "event-id",
        providerOperationId: "operation-id",
      })
    );
    expect(enqueue).toHaveBeenCalledWith({ paymentAttemptId: "attempt-id" });
    expect(markPaidForReservation).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(markProcessed).toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  test("settles a terminal goods payment directly and processes its invoice", async () => {
    const markPaid = mock(() =>
      Effect.succeed({
        attempt: { ...attempt, state: "paid" as const },
        changed: true,
        timestamp: Temporal.Now.instant(),
      })
    );
    const complete = mock(() => Effect.void);
    const start = mock(() => Effect.die("unused"));

    await Effect.runPromise(
      await buildWebhookEffect({
        webhookEvents: {
          insertReceived: mock(() =>
            Effect.succeed({ status: "inserted", event: receivedEvent })
          ),
          linkPaymentAttempt: mock(() => Effect.void),
          markProcessed: mock(() => Effect.void),
          markFailed: mock(() => Effect.void),
          claimRetry: mock(() => Effect.die("unused")),
        },
        paymentAttempts: {
          findByProviderOrderId: mock(() =>
            Effect.succeed({
              ...attempt,
              orderId: "goods-order-id",
              workspaceReservationId: null,
              state: "expired" as const,
              failureCode: "payment_abandoned_after_provider_cutoff",
            })
          ),
        },
        paymentLifecycle: {
          createPendingNexiAttempt: mock(() => Effect.die("unused")),
          attachProviderSession: mock(() => Effect.die("unused")),
          markPaid,
          markTerminal: mock(() => Effect.die("unused")),
        },
        orders: {
          findById: mock(() =>
            Effect.succeed({
              ...order,
              id: "goods-order-id",
              kind: "goods" as const,
              paymentState: "expired" as const,
              fulfillmentState: "fulfilled" as const,
              fulfilledAt: Temporal.Now.instant(),
            })
          ),
        },
        reservations: {
          findById: mock(() => Effect.die("unused")),
        },
        nexi: {
          verifyPaymentOutcome: mock(() => Effect.succeed(verification)),
        },
        completion: { complete },
        latePaymentRecoveries: { start },
      })
    );

    expect(markPaid).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "attempt-id",
        orderId: "goods-order-id",
      })
    );
    expect(complete).toHaveBeenCalledWith({
      orderId: "goods-order-id",
      kind: "goods",
      paymentAttemptId: "attempt-id",
    });
    expect(start).not.toHaveBeenCalled();
  });

  test("does not complete a second successful goods attempt marked for refund", async () => {
    const markPaid = mock(() =>
      Effect.succeed({
        attempt: {
          ...attempt,
          state: "paid" as const,
          refundState: "required" as const,
        },
        changed: false,
        timestamp: Temporal.Now.instant(),
      })
    );
    const complete = mock(() => Effect.void);

    await Effect.runPromise(
      await buildWebhookEffect({
        webhookEvents: {
          insertReceived: mock(() =>
            Effect.succeed({ status: "inserted", event: receivedEvent })
          ),
          linkPaymentAttempt: mock(() => Effect.void),
          markProcessed: mock(() => Effect.void),
          markFailed: mock(() => Effect.void),
          claimRetry: mock(() => Effect.die("unused")),
        },
        paymentAttempts: {
          findByProviderOrderId: mock(() =>
            Effect.succeed({
              ...attempt,
              orderId: "goods-order-id",
              workspaceReservationId: null,
              state: "expired" as const,
              failureCode: "superseded_by_paid_attempt",
            })
          ),
        },
        paymentLifecycle: {
          createPendingNexiAttempt: mock(() => Effect.die("unused")),
          attachProviderSession: mock(() => Effect.die("unused")),
          markPaid,
          markTerminal: mock(() => Effect.die("unused")),
        },
        orders: {
          findById: mock(() =>
            Effect.succeed({
              ...order,
              id: "goods-order-id",
              kind: "goods" as const,
              paymentState: "paid" as const,
              fulfillmentState: "fulfilled" as const,
              fulfilledAt: Temporal.Now.instant(),
            })
          ),
        },
        reservations: {
          findById: mock(() => Effect.die("unused")),
        },
        nexi: {
          verifyPaymentOutcome: mock(() => Effect.succeed(verification)),
        },
        completion: { complete },
      })
    );

    expect(markPaid).toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  test("does not run goods completion for a terminal payment failure", async () => {
    const markTerminal = mock(() =>
      Effect.succeed({
        attempt: { ...attempt, state: "failed" as const },
        changed: true,
        timestamp: Temporal.Now.instant(),
      })
    );
    const complete = mock(() => Effect.die("unused"));
    const failedVerification: PaymentVerificationResult = {
      ...verification,
      status: "failure",
      provider: { ...verification.provider, orderStatus: "DECLINED" },
    };

    await Effect.runPromise(
      await buildWebhookEffect({
        webhookEvents: {
          insertReceived: mock(() =>
            Effect.succeed({ status: "inserted", event: receivedEvent })
          ),
          linkPaymentAttempt: mock(() => Effect.void),
          markProcessed: mock(() => Effect.void),
          markFailed: mock(() => Effect.void),
          claimRetry: mock(() => Effect.die("unused")),
        },
        paymentAttempts: {
          findByProviderOrderId: mock(() =>
            Effect.succeed({
              ...attempt,
              orderId: "goods-order-id",
              workspaceReservationId: null,
            })
          ),
        },
        paymentLifecycle: {
          createPendingNexiAttempt: mock(() => Effect.die("unused")),
          attachProviderSession: mock(() => Effect.die("unused")),
          markPaid: mock(() => Effect.die("unused")),
          markTerminal,
        },
        orders: {
          findById: mock(() =>
            Effect.succeed({
              ...order,
              id: "goods-order-id",
              kind: "goods" as const,
              fulfillmentState: "fulfilled" as const,
              fulfilledAt: Temporal.Now.instant(),
            })
          ),
        },
        reservations: {
          findById: mock(() => Effect.die("unused")),
        },
        nexi: {
          verifyPaymentOutcome: mock(() => Effect.succeed(failedVerification)),
        },
        completion: { complete },
      })
    );

    expect(markTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "goods-order-id", state: "failed" })
    );
    expect(complete).not.toHaveBeenCalled();
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
          },
          paymentAttempts: {
            findByProviderOrderId: mock(() => Effect.succeed(attempt)),
          },
          paymentLifecycle: {
            createPendingNexiAttempt: mock(() => Effect.die("unused")),
            attachProviderSession: mock(() => Effect.die("unused")),
            markPaid: mock(() =>
              Effect.succeed({
                attempt: { ...attempt, state: "paid" as const },
                changed: true,
                timestamp: Temporal.Now.instant(),
              })
            ),
            markTerminal: mock(() => Effect.die("unused")),
          },
          orders: {
            findById: mock(() => Effect.succeed(order)),
          },
          reservations: {
            findById: mock(() => Effect.succeed(reservation as never)),
          },
          nexi: {
            verifyPaymentOutcome: mock(() => Effect.succeed(verification)),
          },
          completion: {
            complete: mock(() =>
              Effect.fail(
                new WorkspacePaidFulfillmentError({
                  orderId: "reservation-id",
                  failureCode: "fulfillment_email_failed",
                  message: "email failed",
                })
              )
            ),
          },
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
