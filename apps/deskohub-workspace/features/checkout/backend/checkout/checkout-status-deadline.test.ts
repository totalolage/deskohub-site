import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";
import { SeatingMapFeatureFlagServiceMock } from "@/features/feature-flags/backend/seating-map-feature-flag.service.mock";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { ReservationRecords } from "@/features/reservation/backend/reservation-records";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { ReviewSandboxMock } from "@/features/review-accounts/backend/review-sandbox.service.mock";
import { PostHogEventService } from "@/shared/backend/analytics/posthog-event.service";
import { makeWorkspaceNexiLayer } from "@/shared/backend/config/nexi.config";
import { WorkspacePaidFulfillmentService } from "../fulfillment/paid-fulfillment.service";
import { PaidFulfillmentQueueService } from "../fulfillment/paid-fulfillment-queue.service";
import { LatePaymentRecoveryQueueService } from "../payment/late-payment-recovery-queue.service";
import { LatePaymentVerificationService } from "../payment/late-payment-verification.service";
import { getNexiCurrencyOverride } from "../payment/nexi-currency";
import { ProviderPaymentFinalizationService } from "../payment/provider-payment-finalization.service";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import { PaymentAttemptRepository } from "../repositories/payment-attempt.repository";
import {
  PaymentLifecycleRepository,
  PaymentLifecycleStateError,
} from "../repositories/payment-lifecycle.repository";
import { CheckoutStatusService } from "./checkout-status.service";
import { loadCheckoutStatusPage } from "./checkout-status-page.server";

mock.module("server-only", () => ({}));

/** The status page route's `maxDuration`. */
const statusPageMaxDurationSeconds = 60;

const orderId = workspaceReservationIdSchema.make("reservation-stalled-nexi");
const createdAt = Temporal.Instant.from("2026-06-01T10:00:00Z");

const pendingReservation = {
  id: orderId,
  correlationId: "correlation-id",
  dotyposCustomerId: "customer-id",
  dotyposReservationId: "dotypos-reservation-id",
  reservationDetails: {
    kind: "cowork",
    entryTier: "profi",
    coffee: true,
    monitorOption: "2x27-qhd",
  },
  locale: "en-US",
  reservationState: "held",
  paymentState: "pending",
  fulfillmentState: "not_started",
  activePaymentAttemptId: "attempt-stalled-nexi",
  createdAt,
  updatedAt: createdAt,
};

const pendingAttempt = {
  id: "attempt-stalled-nexi",
  workspaceReservationId: orderId,
  provider: "nexi" as const,
  providerOrderId: "provider-order-id",
  state: "pending" as const,
  amount: { value: 35_000, exponent: 2, currency: "CZK" },
  securityToken: "security-token",
  providerRedirectUrl: "https://provider.example/pay",
  providerOrderCreatedAt: createdAt,
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  createdAt,
  updatedAt: createdAt,
};

type ProviderFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/** A Nexi sandbox that accepts connections and never answers. */
const stalledFetch: ProviderFetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

/**
 * Loads the status page on a test clock advanced one second at a time until
 * it renders or reaches the route's `maxDuration`. Dotypos never answers.
 */
const loadStatusPageOnTestClock = (options: {
  readonly fetch: ProviderFetch;
  readonly onSecond?: (elapsedSeconds: number) => void;
  readonly paymentState: () => "pending" | "expired";
  readonly markPaid?: () => Effect.Effect<never, PaymentLifecycleStateError>;
  readonly startRecovery: () => Effect.Effect<never>;
}) =>
  Effect.gen(function* () {
    const checkoutStatus = yield* CheckoutStatusService;
    const page = yield* Effect.forkChild(
      loadCheckoutStatusPage(
        checkoutStatus,
        { isAuthorized: () => Effect.succeed(true) },
        {
          locale: "en-US",
          orderId,
          requestHeaders: new Headers(),
          returnOutcome: "success",
        }
      ).pipe(Effect.provideService(FetchHttpClient.Fetch, options.fetch))
    );
    let elapsedSeconds = 0;
    while (
      page.pollUnsafe() === undefined &&
      elapsedSeconds < statusPageMaxDurationSeconds
    ) {
      yield* TestClock.adjust("1 second");
      elapsedSeconds += 1;
      options.onSecond?.(elapsedSeconds);
    }
    if (page.pollUnsafe() === undefined) {
      yield* Fiber.interrupt(page);
      return { elapsedSeconds, status: undefined };
    }
    return { elapsedSeconds, status: yield* Fiber.join(page) };
  }).pipe(
    Effect.provide(
      CheckoutStatusService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            ProviderPaymentFinalizationService.Default,
            LatePaymentVerificationService.Default
          )
        ),
        Layer.provide(
          Layer.mergeAll(
            makeWorkspaceNexiLayer("preview"),
            Layer.mock(PaymentLifecycleRepository, {
              ...(options.markPaid && { markPaid: options.markPaid }),
            }),
            Layer.mock(PaidFulfillmentQueueService, {}),
            Layer.mock(WorkspacePaidFulfillmentService, {}),
            Layer.mock(PostHogEventService, {}),
            Layer.mock(WorkspaceReservationRepository, {
              findById: () =>
                Effect.succeed({
                  ...pendingReservation,
                  paymentState: options.paymentState(),
                } as never),
            }),
            Layer.mock(PaymentAttemptRepository, {
              findById: () =>
                Effect.succeed({
                  ...pendingAttempt,
                  state: options.paymentState(),
                } as never),
              findDisplayableForReservation: () => Effect.succeed(null),
            }),
            Layer.mock(LatePaymentRecoveryRepository, {
              findLatestByWorkspaceReservationId: () => Effect.succeed(null),
              findByPaymentAttemptId: () => Effect.succeed(null),
              start: options.startRecovery,
            }),
            Layer.mock(LatePaymentRecoveryQueueService, {}),
            ReservationRecords.Provider.pipe(
              Layer.provideMerge(
                Layer.mock(DotyposService, {
                  getReservationWithoutCustomer: () => Effect.never,
                  getCustomer: () => Effect.never,
                })
              )
            ),
            Layer.mock(AdvisoryAvailabilityInventory, {
              tables: Effect.never,
            }),
            SeatingMapFeatureFlagServiceMock({
              isEnabled: Effect.succeed(true),
            }),
            ReviewSandboxMock({})
          )
        )
      )
    ),
    Effect.provide(TestClock.layer()),
    Effect.runPromise
  );

test("renders the stored status within the route limit when Nexi and Dotypos stall", async () => {
  const startRecovery = mock(() => Effect.die("unexpected late payment"));

  const { elapsedSeconds, status } = await loadStatusPageOnTestClock({
    fetch: stalledFetch,
    paymentState: () => "pending",
    startRecovery,
  });

  expect(status).toMatchObject({
    orderId,
    status: "pending",
    paymentStatus: "pending",
  });
  // One full 30-second sandbox lookup ran before the deadline stopped retries.
  expect(elapsedSeconds).toBeGreaterThan(30);
  expect(elapsedSeconds).toBeLessThan(statusPageMaxDurationSeconds);
  expect(startRecovery).not.toHaveBeenCalled();
});

test("defers late-payment verification when a slow lookup loses a race with a terminal transition", async () => {
  const currency = getNexiCurrencyOverride() ?? "CZK";
  const settledOrder = {
    orderStatus: {
      order: { orderId: "provider-order-id", amount: "35000", currency },
    },
    operations: [
      {
        operationId: "operation-id",
        operationType: "CAPTURE",
        operationResult: "EXECUTED",
        operationAmount: "35000",
        operationCurrency: currency,
        securityToken: "security-token",
      },
    ],
  };
  // The first lookup times out at 30 seconds; its retry answers at 35.
  const providerLookups: Array<(response: Response) => void> = [];
  const slowThenStalledFetch: ProviderFetch = (_input, init) =>
    new Promise<Response>((resolve, reject) => {
      providerLookups.push(resolve);
      init?.signal?.addEventListener("abort", () =>
        reject(init.signal?.reason)
      );
    });
  // Hold cleanup expires the attempt while the lookup is in flight, so the
  // paid transition fails its lifecycle guard.
  let paymentState: "pending" | "expired" = "pending";
  const markPaid = mock(() => {
    paymentState = "expired";
    return Effect.fail(
      new PaymentLifecycleStateError({
        operation: "markPaid",
        paymentReference: {
          type: "paymentAttemptId",
          id: pendingAttempt.id,
        },
        message: "Only a pending attempt can be marked paid.",
      })
    );
  });
  const startRecovery = mock(() => Effect.die("unexpected recovery start"));

  const { elapsedSeconds, status } = await loadStatusPageOnTestClock({
    fetch: slowThenStalledFetch,
    onSecond: (elapsedSeconds) => {
      if (elapsedSeconds === 35) {
        providerLookups.at(-1)?.(Response.json(settledOrder));
      }
    },
    paymentState: () => paymentState,
    markPaid,
    startRecovery,
  });

  expect(markPaid).toHaveBeenCalledTimes(1);
  expect(status).toMatchObject({
    orderId,
    status: "expired",
    paymentStatus: "expired",
  });
  expect(elapsedSeconds).toBeLessThan(statusPageMaxDurationSeconds);
  // Only 5 seconds of the shared budget remained, too little for a full
  // sandbox request, so no late-payment lookup started.
  expect(providerLookups).toHaveLength(2);
  expect(startRecovery).not.toHaveBeenCalled();
});
