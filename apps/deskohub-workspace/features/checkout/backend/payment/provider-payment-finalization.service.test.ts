import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type {
  NexiService as NexiServiceTag,
  PaymentVerificationResult,
} from "@deskohub/nexi";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer } from "effect";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspacePaidFulfillmentService as WorkspacePaidFulfillmentServiceType } from "../fulfillment/paid-fulfillment.service";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "../repositories/payment-attempt.repository";

type NexiServiceType = typeof NexiServiceTag.Service;

const paidNotStartedReservation = {
  id: "reservation-id",
  correlationId: "correlation-id",
  paymentState: "paid",
  fulfillmentState: "not_started",
  activePaymentAttemptId: "attempt-id",
};

const pendingReservation = {
  ...paidNotStartedReservation,
  paymentState: "pending",
};

const pendingAttempt = {
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
  createdAt: Temporal.Now.instant(),
  updatedAt: Temporal.Now.instant(),
};

const buildVerification = (
  status: PaymentVerificationResult["status"]
): PaymentVerificationResult => ({
  status,
  provider: {
    orderId: "provider-order-id",
    operationId: "operation-id",
    amount: "35000",
    currency: "CZK",
    orderStatus: status === "failure" ? "DECLINED" : "EXECUTED",
    captureExecuted: status === "success",
  },
  mismatches: [],
});

describe("ProviderPaymentFinalizationService", () => {
  for (const fulfillmentState of ["not_started", "processing"] as const) {
    test(`starts fulfillment for already-paid ${fulfillmentState} provider returns`, async () => {
      const {
        ProviderPaymentFinalizationService,
        ProviderPaymentFinalizationServiceLive,
      } = await import("./provider-payment-finalization.service");
      const { PaymentAttemptRepository } = await import(
        "../repositories/payment-attempt.repository"
      );
      const { WorkspacePaidFulfillmentService } = await import(
        "../fulfillment/paid-fulfillment.service"
      );
      const { WorkspaceReservationRepository } = await import(
        "@/features/reservation/backend/workspace-reservation.repository"
      );
      const { PostHogEventService } = await import(
        "@/shared/backend/analytics/posthog-event.service"
      );
      const { NexiService } = await import("@deskohub/nexi");

      const fulfillPaidOrder = mock(() => Effect.void);
      const reservations = {
        findById: mock(() =>
          Effect.succeed({ ...paidNotStartedReservation, fulfillmentState })
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
        Effect.provide(
          ProviderPaymentFinalizationServiceLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(WorkspaceReservationRepository, reservations),
                Layer.succeed(WorkspacePaidFulfillmentService, fulfillment),
                Layer.succeed(
                  PaymentAttemptRepository,
                  {} as PaymentAttemptRepositoryType
                ),
                Layer.succeed(PostHogEventService, {
                  capture: () => Effect.void,
                }),
                Layer.succeed(NexiService, {} as NexiServiceType)
              )
            )
          )
        ),
        Effect.runPromise
      );

      expect(result).toBe("paid");
      expect(fulfillPaidOrder).toHaveBeenCalledWith({
        orderId: "reservation-id",
      });
    });
  }

  test("does not retry fulfillment after a paid reservation has failed fulfillment", async () => {
    const {
      ProviderPaymentFinalizationService,
      ProviderPaymentFinalizationServiceLive,
    } = await import("./provider-payment-finalization.service");
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
    );
    const { WorkspacePaidFulfillmentService } = await import(
      "../fulfillment/paid-fulfillment.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
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
      Effect.provide(
        ProviderPaymentFinalizationServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(WorkspaceReservationRepository, reservations),
              Layer.succeed(WorkspacePaidFulfillmentService, fulfillment),
              Layer.succeed(
                PaymentAttemptRepository,
                {} as PaymentAttemptRepositoryType
              ),
              Layer.succeed(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.succeed(NexiService, {} as NexiServiceType)
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("not_pending");
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
  });

  for (const scenario of [
    { verificationStatus: "success" as const, expected: "paid" as const },
    { verificationStatus: "failure" as const, expected: "terminal" as const },
  ]) {
    test(`finalizes pending ${scenario.verificationStatus} provider payments`, async () => {
      const {
        ProviderPaymentFinalizationService,
        ProviderPaymentFinalizationServiceLive,
      } = await import("./provider-payment-finalization.service");
      const { PaymentAttemptRepository } = await import(
        "../repositories/payment-attempt.repository"
      );
      const { WorkspacePaidFulfillmentService } = await import(
        "../fulfillment/paid-fulfillment.service"
      );
      const { WorkspaceReservationRepository } = await import(
        "@/features/reservation/backend/workspace-reservation.repository"
      );
      const { PostHogEventService } = await import(
        "@/shared/backend/analytics/posthog-event.service"
      );
      const { NexiService } = await import("@deskohub/nexi");

      const markPaidForReservation = mock(() =>
        Effect.succeed({
          attempt: { ...pendingAttempt, state: "paid" as const },
          changed: true,
          timestamp: Temporal.Now.instant(),
        })
      );
      const markTerminalForReservation = mock(() =>
        Effect.succeed({
          attempt: {
            ...pendingAttempt,
            state: "failed" as const,
            failureCode: "nexi_payment_failed",
            lastProviderStatus: "DECLINED",
          },
          changed: true,
          timestamp: Temporal.Now.instant(),
        })
      );
      const fulfillPaidOrder = mock(() => Effect.void);
      const paymentAttempts = {
        findById: mock(() => Effect.succeed(pendingAttempt)),
        markPaidForReservation,
        markTerminalForReservation,
      } as unknown as PaymentAttemptRepositoryType;
      const reservations = {
        findById: mock(() => Effect.succeed(pendingReservation)),
      } as unknown as WorkspaceReservationRepositoryType;
      const nexi = {
        verifyPaymentOutcome: mock(() =>
          Effect.succeed(buildVerification(scenario.verificationStatus))
        ),
      } as unknown as NexiServiceType;

      const result = await Effect.gen(function* () {
        const service = yield* ProviderPaymentFinalizationService;
        return yield* service.finalizePendingProviderPayment({
          orderId: "reservation-id",
          paymentAttemptId: "attempt-id",
          webhookEventId: "event-id",
        });
      }).pipe(
        Effect.provide(
          ProviderPaymentFinalizationServiceLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(WorkspaceReservationRepository, reservations),
                Layer.succeed(WorkspacePaidFulfillmentService, {
                  fulfillPaidOrder,
                }),
                Layer.succeed(PaymentAttemptRepository, paymentAttempts),
                Layer.succeed(PostHogEventService, {
                  capture: mock(() => Effect.void),
                }),
                Layer.succeed(NexiService, nexi)
              )
            )
          )
        ),
        Effect.runPromise
      );

      expect(result).toBe(scenario.expected);
      expect(nexi.verifyPaymentOutcome).toHaveBeenCalledWith({
        orderId: "provider-order-id",
        correlationId: "correlation-id",
        amount: "35000",
        currency: "CZK",
        securityToken: "security-token",
      });

      if (scenario.expected === "paid") {
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
        expect(markTerminalForReservation).not.toHaveBeenCalled();
      } else {
        expect(markTerminalForReservation).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "attempt-id",
            workspaceReservationId: "reservation-id",
            state: "failed",
            failureCode: "nexi_payment_failed",
            webhookEventId: "event-id",
          })
        );
        expect(markPaidForReservation).not.toHaveBeenCalled();
        expect(fulfillPaidOrder).not.toHaveBeenCalled();
      }
    });
  }

  test("returns not_verifiable for pending attempts missing local verification data", async () => {
    const {
      ProviderPaymentFinalizationService,
      ProviderPaymentFinalizationServiceLive,
    } = await import("./provider-payment-finalization.service");
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
    );
    const { WorkspacePaidFulfillmentService } = await import(
      "../fulfillment/paid-fulfillment.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );
    const { NexiService } = await import("@deskohub/nexi");

    const verifyPaymentOutcome = mock(() => Effect.die("not used"));
    const result = await Effect.gen(function* () {
      const service = yield* ProviderPaymentFinalizationService;
      return yield* service.finalizePendingProviderPayment({
        orderId: "reservation-id",
        paymentAttemptId: "attempt-id",
      });
    }).pipe(
      Effect.provide(
        ProviderPaymentFinalizationServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(pendingReservation)),
              } as unknown as WorkspaceReservationRepositoryType),
              Layer.succeed(WorkspacePaidFulfillmentService, {
                fulfillPaidOrder: mock(() => Effect.void),
              }),
              Layer.succeed(PaymentAttemptRepository, {
                findById: mock(() =>
                  Effect.succeed({ ...pendingAttempt, securityToken: null })
                ),
              } as unknown as PaymentAttemptRepositoryType),
              Layer.succeed(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.succeed(NexiService, {
                verifyPaymentOutcome,
              } as unknown as NexiServiceType)
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("not_verifiable");
    expect(verifyPaymentOutcome).not.toHaveBeenCalled();
  });

  test("returns provider_verification_failed when Nexi verification errors", async () => {
    const {
      ProviderPaymentFinalizationService,
      ProviderPaymentFinalizationServiceLive,
    } = await import("./provider-payment-finalization.service");
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
    );
    const { WorkspacePaidFulfillmentService } = await import(
      "../fulfillment/paid-fulfillment.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );
    const { NexiService } = await import("@deskohub/nexi");

    const markPaidForReservation = mock(() => Effect.die("not used"));
    const markTerminalForReservation = mock(() => Effect.die("not used"));
    const verifyPaymentOutcome = mock(() =>
      Effect.fail(
        new EffectDrizzleQueryError({
          query: "nexi.verifyPaymentOutcome",
          params: [],
          cause: "nexi down",
        })
      )
    );

    const result = await Effect.gen(function* () {
      const service = yield* ProviderPaymentFinalizationService;
      return yield* service.finalizePendingProviderPayment({
        orderId: "reservation-id",
        paymentAttemptId: "attempt-id",
      });
    }).pipe(
      Effect.provide(
        ProviderPaymentFinalizationServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(pendingReservation)),
              } as unknown as WorkspaceReservationRepositoryType),
              Layer.succeed(WorkspacePaidFulfillmentService, {
                fulfillPaidOrder: mock(() => Effect.void),
              }),
              Layer.succeed(PaymentAttemptRepository, {
                findById: mock(() => Effect.succeed(pendingAttempt)),
                markPaidForReservation,
                markTerminalForReservation,
              } as unknown as PaymentAttemptRepositoryType),
              Layer.succeed(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.succeed(NexiService, {
                verifyPaymentOutcome,
              } as unknown as NexiServiceType)
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("provider_verification_failed");
    expect(verifyPaymentOutcome).toHaveBeenCalledWith({
      orderId: "provider-order-id",
      correlationId: "correlation-id",
      amount: "35000",
      currency: "CZK",
      securityToken: "security-token",
    });
    expect(markPaidForReservation).not.toHaveBeenCalled();
    expect(markTerminalForReservation).not.toHaveBeenCalled();
  });
});
