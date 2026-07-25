import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type {
  NexiService as NexiServiceTag,
  PaymentVerificationResult,
} from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  WorkspacePaidFulfillmentError,
  type WorkspacePaidFulfillmentService as WorkspacePaidFulfillmentServiceType,
} from "../fulfillment/paid-fulfillment.service";
import type { ReservationHoldCleanupService as ReservationHoldCleanupServiceType } from "../holds/reservation-hold-cleanup.service";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "../repositories/payment-attempt.repository";
import {
  type IPaymentLifecycleRepository,
  PaymentLifecycleStateError,
} from "../repositories/payment-lifecycle.repository";
import type { WebhookEventRepository as WebhookEventRepositoryType } from "../repositories/webhook-event.repository";

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
    operationCurrency: "EUR",
  },
};
const failurePayload = {
  ...payload,
  operation: {
    ...payload.operation,
    operationResult: "DECLINED",
  },
};

const attempt = {
  id: "attempt-id",
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
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  createdAt: Temporal.Now.instant(),
  updatedAt: Temporal.Now.instant(),
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
    operationType: "CAPTURE",
    amount: "35000",
    currency: "EUR",
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
  readonly reservations: WorkspaceReservationRepositoryType;
  readonly nexi: NexiServiceType;
  readonly fulfillment: WorkspacePaidFulfillmentServiceType;
};

const buildWebhookEffect = async (
  services: NexiWebhookTestServices,
  notification: unknown = payload
) => {
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
    "../repositories/payment-attempt.repository"
  );
  const { PaymentLifecycleRepository } = await import(
    "../repositories/payment-lifecycle.repository"
  );
  const { WorkspacePaidFulfillmentService } = await import(
    "../fulfillment/paid-fulfillment.service"
  );
  const { ReservationHoldCleanupService } = await import(
    "../holds/reservation-hold-cleanup.service"
  );
  const { WebhookEventRepository } = await import(
    "../repositories/webhook-event.repository"
  );

  return Effect.gen(function* () {
    const service = yield* NexiWebhookService;
    return yield* service.processNotification(notification);
  }).pipe(
    Effect.provide(
      NexiWebhookServiceLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(WebhookEventRepository, services.webhookEvents),
            Layer.succeed(PaymentAttemptRepository, services.paymentAttempts),
            Layer.succeed(
              PaymentLifecycleRepository,
              services.paymentLifecycle
            ),
            Layer.succeed(
              WorkspaceReservationRepository,
              services.reservations
            ),
            Layer.succeed(ReservationHoldCleanupService, {
              cancelOrderHold: mock(() => Effect.die("unused")),
              sweepExpiredHolds: mock(() => Effect.die("unused")),
            } as unknown as ReservationHoldCleanupServiceType),
            Layer.succeed(NexiService, services.nexi),
            Layer.succeed(
              WorkspacePaidFulfillmentService,
              services.fulfillment
            ),
            Layer.succeed(PostHogEventService, {
              capture: mock(() => Effect.void),
            })
          )
        )
      )
    )
  );
};

describe("NexiWebhookService", () => {
  test("settles an unattached remote order by stable identity and marks processed", async () => {
    const linkPaymentAttempt = mock(() => Effect.void);
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);
    const markPaidForReservation = mock(() =>
      Effect.succeed({
        attempt: { ...attempt, state: "paid" as const },
        changed: false,
        timestamp: Temporal.Now.instant(),
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
          findByProviderOrderId: mock(() =>
            Effect.succeed({
              ...attempt,
              state: "created" as const,
              securityToken: null,
              providerRedirectUrl: null,
            })
          ),
        } as unknown as PaymentAttemptRepositoryType,
        paymentLifecycle: {
          admitPaymentStart: mock(() => Effect.die("unused")),
          attachProviderSession: mock(() => Effect.die("unused")),
          markProviderStartFailed: mock(() => Effect.die("unused")),
          markPaid: markPaidForReservation,
          markTerminal: mock(() => Effect.die("unused")),
        },
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
      currency: "EUR",
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

  test("settles a provider failure idempotently and marks the event processed", async () => {
    const markProcessed = mock(() => Effect.void);
    const markTerminal = mock(() =>
      Effect.succeed({
        attempt: {
          ...attempt,
          state: "failed" as const,
          failureCode: "nexi_payment_failed",
        },
        changed: false,
        timestamp: Temporal.Now.instant(),
      })
    );

    const result = await Effect.runPromise(
      await buildWebhookEffect(
        {
          webhookEvents: {
            insertReceived: mock(() =>
              Effect.succeed({ status: "inserted", event: receivedEvent })
            ),
            linkPaymentAttempt: mock(() => Effect.void),
            markProcessed,
            markFailed: mock(() => Effect.void),
            claimRetry: mock(() => Effect.die("unused")),
          } as unknown as WebhookEventRepositoryType,
          paymentAttempts: {
            findByProviderOrderId: mock(() => Effect.succeed(attempt)),
          } as unknown as PaymentAttemptRepositoryType,
          paymentLifecycle: {
            admitPaymentStart: mock(() => Effect.die("unused")),
            attachProviderSession: mock(() => Effect.die("unused")),
            markProviderStartFailed: mock(() => Effect.die("unused")),
            markPaid: mock(() => Effect.die("unused")),
            markTerminal,
          },
          reservations: {
            findById: mock(() => Effect.succeed(reservation as never)),
          } as unknown as WorkspaceReservationRepositoryType,
          nexi: {
            verifyPaymentOutcome: mock(() =>
              Effect.succeed({
                ...verification,
                status: "failure",
                provider: {
                  ...verification.provider,
                  orderStatus: "DECLINED",
                  captureExecuted: false,
                },
              })
            ),
          } as unknown as NexiServiceType,
          fulfillment: {
            fulfillPaidOrder: mock(() => Effect.die("unused")),
          },
        },
        failurePayload
      )
    );

    expect(result.status).toBe("accepted");
    expect(markTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "attempt-id",
        workspaceReservationId: "reservation-id",
        state: "failed",
        failureCode: "nexi_payment_failed",
        webhookEventId: "event-id",
      })
    );
    expect(markProcessed).toHaveBeenCalledTimes(1);
  });

  test("marks a contradictory terminal replay failed and never processed", async () => {
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);

    const result = await Effect.runPromise(
      Effect.result(
        await buildWebhookEffect(
          {
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
            } as unknown as PaymentAttemptRepositoryType,
            paymentLifecycle: {
              admitPaymentStart: mock(() => Effect.die("unused")),
              attachProviderSession: mock(() => Effect.die("unused")),
              markProviderStartFailed: mock(() => Effect.die("unused")),
              markPaid: mock(() => Effect.die("unused")),
              markTerminal: mock(() =>
                Effect.fail(
                  new PaymentLifecycleStateError({
                    operation: "markTerminal",
                    paymentAttemptId: attempt.id,
                    message:
                      "The terminal replay conflicts with the recorded lifecycle outcome.",
                  })
                )
              ),
            },
            reservations: {
              findById: mock(() => Effect.succeed(reservation as never)),
            } as unknown as WorkspaceReservationRepositoryType,
            nexi: {
              verifyPaymentOutcome: mock(() =>
                Effect.succeed({
                  ...verification,
                  status: "failure",
                  provider: {
                    ...verification.provider,
                    orderStatus: "DECLINED",
                    captureExecuted: false,
                  },
                })
              ),
            } as unknown as NexiServiceType,
            fulfillment: {
              fulfillPaidOrder: mock(() => Effect.die("unused")),
            },
          },
          failurePayload
        )
      )
    );

    expect(result._tag).toBe("Failure");
    expect(markFailed).toHaveBeenCalledWith({
      type: "eventId",
      eventId: "event-id",
      errorCode: "nexi_webhook_transition_failed",
    });
    expect(markProcessed).not.toHaveBeenCalled();
  });

  test("marks a contradictory paid replay failed and never processed", async () => {
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
          } as unknown as PaymentAttemptRepositoryType,
          paymentLifecycle: {
            admitPaymentStart: mock(() => Effect.die("unused")),
            attachProviderSession: mock(() => Effect.die("unused")),
            markProviderStartFailed: mock(() => Effect.die("unused")),
            markPaid: mock(() =>
              Effect.fail(
                new PaymentLifecycleStateError({
                  operation: "markPaid",
                  paymentAttemptId: attempt.id,
                  message:
                    "The paid replay conflicts with recorded provider evidence.",
                })
              )
            ),
            markTerminal: mock(() => Effect.die("unused")),
          },
          reservations: {
            findById: mock(() => Effect.succeed(reservation as never)),
          } as unknown as WorkspaceReservationRepositoryType,
          nexi: {
            verifyPaymentOutcome: mock(() => Effect.succeed(verification)),
          } as unknown as NexiServiceType,
          fulfillment: {
            fulfillPaidOrder: mock(() => Effect.die("unused")),
          },
        })
      )
    );

    expect(result._tag).toBe("Failure");
    expect(markFailed).toHaveBeenCalledWith({
      type: "eventId",
      eventId: "event-id",
      errorCode: "nexi_webhook_transition_failed",
    });
    expect(markProcessed).not.toHaveBeenCalled();
  });

  test("keeps contradictory webhook operation evidence unprocessed", async () => {
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);
    const markPaid = mock(() => Effect.die("unused"));
    const fulfillPaidOrder = mock(() => Effect.die("unused"));
    const contradictoryPayload = {
      ...payload,
      operation: {
        ...payload.operation,
        operationId: "later-terminal-operation",
        operationResult: "REFUNDED",
        operationAmount: "34999",
        operationCurrency: "EUR",
      },
    };

    const result = await Effect.runPromise(
      Effect.result(
        await buildWebhookEffect(
          {
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
            } as unknown as PaymentAttemptRepositoryType,
            paymentLifecycle: {
              admitPaymentStart: mock(() => Effect.die("unused")),
              attachProviderSession: mock(() => Effect.die("unused")),
              markProviderStartFailed: mock(() => Effect.die("unused")),
              markPaid,
              markTerminal: mock(() => Effect.die("unused")),
            },
            reservations: {
              findById: mock(() => Effect.succeed(reservation as never)),
            } as unknown as WorkspaceReservationRepositoryType,
            nexi: {
              verifyPaymentOutcome: mock(() => Effect.succeed(verification)),
            } as unknown as NexiServiceType,
            fulfillment: { fulfillPaidOrder },
          },
          contradictoryPayload
        )
      )
    );

    expect(result._tag).toBe("Failure");
    expect(markFailed).toHaveBeenCalledWith({
      type: "eventId",
      eventId: "event-id",
      errorCode: "nexi_webhook_verification_mismatch",
    });
    expect(markProcessed).not.toHaveBeenCalled();
    expect(markPaid).not.toHaveBeenCalled();
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
  });

  test("keeps manual-review provider evidence failed and unprocessed", async () => {
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);
    const markPaid = mock(() => Effect.die("unused"));
    const markTerminal = mock(() => Effect.die("unused"));

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
          } as unknown as PaymentAttemptRepositoryType,
          paymentLifecycle: {
            admitPaymentStart: mock(() => Effect.die("unused")),
            attachProviderSession: mock(() => Effect.die("unused")),
            markProviderStartFailed: mock(() => Effect.die("unused")),
            markPaid,
            markTerminal,
          },
          reservations: {
            findById: mock(() => Effect.succeed(reservation as never)),
          } as unknown as WorkspaceReservationRepositoryType,
          nexi: {
            verifyPaymentOutcome: mock(() =>
              Effect.succeed({
                ...verification,
                status: "manual_review",
                mismatches: [],
              })
            ),
          } as unknown as NexiServiceType,
          fulfillment: {
            fulfillPaidOrder: mock(() => Effect.die("unused")),
          },
        })
      )
    );

    expect(result._tag).toBe("Failure");
    expect(markFailed).toHaveBeenCalledWith({
      type: "eventId",
      eventId: "event-id",
      errorCode: "nexi_webhook_verification_mismatch",
    });
    expect(markProcessed).not.toHaveBeenCalled();
    expect(markPaid).not.toHaveBeenCalled();
    expect(markTerminal).not.toHaveBeenCalled();
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
          } as unknown as PaymentAttemptRepositoryType,
          paymentLifecycle: {
            admitPaymentStart: mock(() => Effect.die("unused")),
            attachProviderSession: mock(() => Effect.die("unused")),
            markProviderStartFailed: mock(() => Effect.die("unused")),
            markPaid: mock(() =>
              Effect.succeed({
                attempt: { ...attempt, state: "paid" as const },
                changed: true,
                timestamp: Temporal.Now.instant(),
              })
            ),
            markTerminal: mock(() => Effect.die("unused")),
          },
          reservations: {
            findById: mock(() => Effect.succeed(reservation as never)),
          } as unknown as WorkspaceReservationRepositoryType,
          nexi: {
            verifyPaymentOutcome: mock(() => Effect.succeed(verification)),
          } as unknown as NexiServiceType,
          fulfillment: {
            fulfillPaidOrder: mock(() =>
              Effect.fail(
                new WorkspacePaidFulfillmentError({
                  orderId: "reservation-id",
                  failureCode: "fulfillment_email_failed",
                  message: "email failed",
                })
              )
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
