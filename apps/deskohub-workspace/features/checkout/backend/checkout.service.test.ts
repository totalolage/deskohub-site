import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { NexiService } from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "@/features/checkout/backend/payment-attempt.repository";
import type { ReservationHoldCleanupService as ReservationHoldCleanupServiceType } from "@/features/checkout/backend/reservation-hold-cleanup.service";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import type { ReservationOrderData } from "@/features/reservation/schemas/reservation";
import { buildSignedPayState, sealPayState } from "./pay-state";

mock.module("server-only", () => ({}));

mock.module("@/features/legal/acceptance-snapshot", () => ({
  getLegalAcceptanceSnapshot: mock(() =>
    Promise.resolve({
      termsAndConditions: {
        path: "/legal/terms.md",
        hash: "terms-test-hash",
        hashAlgorithm: "sha256",
      },
      operatingRules: {
        path: "/legal/rules.md",
        hash: "rules-test-hash",
        hashAlgorithm: "sha256",
      },
    })
  ),
}));

const reservationData: ReservationOrderData = {
  entryTier: "profi",
  date: "2026-06-20",
  coffee: false,
  monitorOption: "2x27-qhd",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
};

const buildPayStateToken = (orderId: string) => {
  const quote = buildWorkspaceCheckoutQuote(reservationData);
  return sealPayState(
    buildSignedPayState({
      locale: "en-US",
      reservation: reservationData,
      quote,
      orderId,
      ttlMilliseconds: 10 * 60 * 1000,
    })
  );
};

describe("CheckoutService", () => {
  test("marks HPP provider-create failures atomically for the reservation", async () => {
    const { CheckoutService, CheckoutServiceLive } = await import(
      "./checkout.service"
    );
    const { LegalEvidenceEventRepository } = await import(
      "./legal-evidence-event.repository"
    );
    const { PaymentAttemptRepository } = await import(
      "./payment-attempt.repository"
    );
    const { ReservationHoldCleanupService } = await import(
      "./reservation-hold-cleanup.service"
    );
    const { ReservationHoldCleanupScheduleService } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );
    const { PostResponseTaskService } = await import(
      "@/shared/backend/post-response-task.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );

    const orderId = "reservation-hpp-create-fails";
    const attemptId = "attempt-hpp-create-fails";
    const attempt = {
      id: attemptId,
      workspaceReservationId: orderId,
      provider: "nexi" as const,
      providerOrderId: attemptId,
      state: "created" as const,
      amountValue: 35_000,
      amountExponent: 2,
      currency: "CZK",
      securityToken: null,
      providerRedirectUrl: null,
      lastWebhookEventId: null,
      lastProviderOperationId: null,
      lastProviderStatus: null,
      failureCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const markTerminal = mock(() => Effect.void);
    const markPaymentTerminal = mock(() => Effect.void);
    const markTerminalForReservation = mock(() =>
      Effect.succeed({
        attempt: {
          ...attempt,
          state: "failed" as const,
          failureCode: "nexi_hpp_create_failed",
          lastProviderStatus: "hpp_create_failed",
        },
        changed: true,
        timestamp: new Date(),
      })
    );

    const paymentAttempts: PaymentAttemptRepositoryType = {
      create: mock(() => Effect.succeed(attempt)),
      findById: mock(() => Effect.succeed(null)),
      findByProviderOrderId: mock(() => Effect.succeed(null)),
      attachHostedPaymentPage: mock(() => Effect.succeed(attempt)),
      markPaid: mock(() => Effect.void),
      markTerminal,
      markPaidForReservation: mock(() =>
        Effect.succeed({
          attempt,
          changed: true,
          timestamp: new Date(),
        })
      ),
      markTerminalForReservation,
    };
    const reservations = {
      findById: mock(() =>
        Effect.succeed({
          id: orderId,
          reservationIntentKey: "intent-key",
          dotyposCustomerId: "customer-id",
          dotyposReservationId: "dotypos-reservation-id",
          productTier: reservationData.entryTier,
          productCoffee: reservationData.coffee,
          productMonitorOption: reservationData.monitorOption,
          locale: "en-US",
          reservationState: "held",
          reservationHoldExpiresAt: new Date("2099-06-20T10:00:00.000Z"),
          reservationCreatedAt: new Date("2026-06-01T10:00:00.000Z"),
          reservationCancelledAt: null,
          holdExpiredAt: null,
          cancellationClaimedAt: null,
          holdCreationClaimedAt: null,
          paymentState: "not_started",
          activePaymentAttemptId: null,
          failureCode: null,
          paidAt: null,
          fulfillmentState: "not_started",
          fulfillmentClaimedAt: null,
          fulfilledAt: null,
          reservationConfirmedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ),
      updateProductIntent: mock((input) =>
        Effect.succeed({ id: input.id } as never)
      ),
      markPaymentTerminal,
    } as unknown as WorkspaceReservationRepositoryType;
    const dotypos = {
      findCustomer: mock(() => Effect.succeed({ _tag: "NotFound" as const })),
      getCustomer: mock(() => Effect.succeed({ id: "customer-id" })),
      getCustomerDiscount: mock(() => Effect.succeed(undefined)),
    } as unknown as typeof DotyposService.Service;
    const nexi = {
      createHostedPaymentPage: mock(() =>
        Effect.fail(new Error("provider create failed"))
      ),
      verifyPaymentOutcome: mock(() => Effect.die("not used")),
    } as unknown as typeof NexiService.Service;
    const holdCleanup: ReservationHoldCleanupServiceType = {
      cancelOrderHold: mock(() => Effect.succeed("cancelled" as const)),
      sweepExpiredHolds: mock(() =>
        Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
      ),
    };

    await Effect.gen(function* () {
      const service = yield* CheckoutService;
      return yield* service.createHostedPaymentCheckout(
        { payStateToken: buildPayStateToken(orderId), legalConsent: true },
        "en-US"
      );
    }).pipe(
      Effect.provide(CheckoutServiceLive),
      Effect.provide(Layer.succeed(DotyposService, dotypos)),
      Effect.provide(Layer.succeed(NexiService, nexi)),
      Effect.provide(
        Layer.succeed(WorkspaceReservationRepository, reservations)
      ),
      Effect.provide(Layer.succeed(PaymentAttemptRepository, paymentAttempts)),
      Effect.provide(
        Layer.succeed(PostHogEventService, {
          capture: mock(() => Effect.void),
        })
      ),
      Effect.provide(
        Layer.succeed(LegalEvidenceEventRepository, {
          recordMany: mock(() => Effect.void),
        })
      ),
      Effect.provide(Layer.succeed(ReservationHoldCleanupService, holdCleanup)),
      Effect.provide(
        Layer.succeed(ReservationHoldCleanupScheduleService, {
          enqueueCleanup: mock(() => Effect.void),
        })
      ),
      Effect.provide(
        Layer.succeed(PostResponseTaskService, {
          run: mock(() => Effect.void),
        })
      ),
      Effect.flip,
      Effect.runPromise
    );

    expect(markTerminalForReservation).toHaveBeenCalledTimes(1);
    expect(markTerminalForReservation).toHaveBeenCalledWith({
      id: attemptId,
      workspaceReservationId: orderId,
      state: "failed",
      failureCode: "nexi_hpp_create_failed",
      providerStatus: "hpp_create_failed",
    });
    expect(holdCleanup.sweepExpiredHolds).not.toHaveBeenCalled();
    expect(markTerminal).not.toHaveBeenCalled();
    expect(markPaymentTerminal).not.toHaveBeenCalled();
  });
});
