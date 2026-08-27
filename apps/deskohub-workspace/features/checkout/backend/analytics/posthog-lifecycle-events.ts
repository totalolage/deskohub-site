import {
  PostHogDistinctId,
  PostHogEventId,
} from "@deskohub/posthog/identifiers";
import { Effect } from "effect";
import type { WorkspaceReservation } from "@/db/schema";
import type { PaymentAttempt } from "@/features/checkout/backend/repositories/payment-attempt.repository";
import type {
  CheckoutAttemptId,
  PaymentAttemptId,
} from "@/features/checkout/checkout-identifiers";
import { toWorkspaceMoneyMajorAmount } from "@/features/checkout/workspace-money";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type {
  ReservationAvailabilityResult,
  ReservationPrePaymentOutcome,
} from "@/features/reservation/reservation-analytics";
import {
  type PostHogEventProperties,
  PostHogEventService,
} from "@/shared/backend/analytics/posthog-event.service";
import { CurrentPostHogRequestContext } from "@/shared/backend/analytics/posthog-request-context";

type LifecycleEventTimestamp = WorkspaceReservation["createdAt"];

const reservationProperties = (
  reservation: Pick<WorkspaceReservation, "id">
): PostHogEventProperties => ({
  reservation_id: reservation.id,
  workspace_reservation_id: reservation.id,
});

type PaymentLifecycleAttempt = Pick<
  PaymentAttempt,
  "amount" | "id" | "provider" | "providerOrderId" | "workspaceReservationId"
>;

const paymentProperties = (
  attempt: PaymentLifecycleAttempt
): PostHogEventProperties => ({
  currency: attempt.amount.currency,
  revenue: toWorkspaceMoneyMajorAmount(attempt.amount),
  reservation_id: attempt.workspaceReservationId,
  payment_attempt_id: attempt.id,
  provider: attempt.provider,
  provider_order_id: attempt.providerOrderId ?? undefined,
});

const captureLifecycleEvent = Effect.fn("posthog.captureLifecycleEvent")(
  function* (input: {
    readonly distinctId: WorkspaceReservationId;
    readonly event: string;
    readonly id: WorkspaceReservationId | PaymentAttemptId;
    readonly properties: PostHogEventProperties;
    readonly timestamp: LifecycleEventTimestamp;
  }) {
    const posthog = yield* PostHogEventService;
    yield* posthog.capture({
      distinctId: PostHogDistinctId.make(input.distinctId),
      event: input.event,
      properties: input.properties,
      timestamp: input.timestamp,
      uuid: PostHogEventId.make(`${input.id}:${input.event}`),
    });
  }
);

export const captureReservationStarted = Effect.fn(
  "posthog.captureReservationStarted"
)(function* (input: {
  readonly reservation: Pick<
    WorkspaceReservation,
    "id" | "dotyposReservationId"
  >;
  readonly timestamp: LifecycleEventTimestamp;
}) {
  const posthog = yield* PostHogEventService;
  const requestContext = yield* CurrentPostHogRequestContext;
  if (requestContext.distinctId) {
    yield* posthog.alias({
      distinctId: requestContext.distinctId,
      alias: PostHogDistinctId.make(input.reservation.id),
    });
  }

  yield* captureLifecycleEvent({
    distinctId: input.reservation.id,
    event: "reservation started",
    id: input.reservation.id,
    properties: {
      ...reservationProperties(input.reservation),
      dotypos_reservation_id:
        input.reservation.dotyposReservationId ?? undefined,
    },
    timestamp: input.timestamp,
  });
});

const captureRequestEvent = Effect.fn("posthog.captureRequestEvent")(
  function* (input: {
    readonly event: string;
    readonly id: CheckoutAttemptId;
    readonly result: string;
    readonly properties: PostHogEventProperties;
    readonly timestamp: LifecycleEventTimestamp;
  }) {
    const { distinctId } = yield* CurrentPostHogRequestContext;
    if (!distinctId) return;

    const posthog = yield* PostHogEventService;
    yield* posthog.capture({
      distinctId,
      event: input.event,
      properties: input.properties,
      timestamp: input.timestamp,
      uuid: PostHogEventId.make(`${input.id}:${input.event}:${input.result}`),
    });
  }
);

export const captureAvailabilityResult = (input: {
  readonly checkoutAttemptId: CheckoutAttemptId;
  readonly result: ReservationAvailabilityResult;
  readonly timestamp: LifecycleEventTimestamp;
}) =>
  captureRequestEvent({
    event: "availability result",
    id: input.checkoutAttemptId,
    properties: { result: input.result },
    result: input.result,
    timestamp: input.timestamp,
  });

export const capturePrePaymentOutcome = (input: {
  readonly checkoutAttemptId: CheckoutAttemptId;
  readonly outcome: ReservationPrePaymentOutcome;
  readonly timestamp: LifecycleEventTimestamp;
}) =>
  captureRequestEvent({
    event: "pre-payment outcome",
    id: input.checkoutAttemptId,
    properties: { outcome: input.outcome },
    result: input.outcome,
    timestamp: input.timestamp,
  });

export const captureReservationAbandoned = (input: {
  readonly reservation: Pick<
    WorkspaceReservation,
    "id" | "dotyposReservationId"
  >;
  readonly timestamp: LifecycleEventTimestamp;
}) =>
  captureLifecycleEvent({
    distinctId: input.reservation.id,
    event: "reservation abandoned",
    id: input.reservation.id,
    properties: reservationProperties(input.reservation),
    timestamp: input.timestamp,
  });

export const captureReservationCompleted = (input: {
  readonly reservation: Pick<
    WorkspaceReservation,
    "id" | "dotyposReservationId"
  >;
  readonly timestamp: LifecycleEventTimestamp;
}) =>
  captureLifecycleEvent({
    distinctId: input.reservation.id,
    event: "reservation completed",
    id: input.reservation.id,
    properties: {
      ...reservationProperties(input.reservation),
      dotypos_reservation_id:
        input.reservation.dotyposReservationId ?? undefined,
    },
    timestamp: input.timestamp,
  });

export const captureReservationFulfilled = (input: {
  readonly reservation: Pick<
    WorkspaceReservation,
    "id" | "dotyposCustomerId" | "dotyposReservationId"
  >;
  readonly timestamp: LifecycleEventTimestamp;
}) =>
  captureLifecycleEvent({
    distinctId: input.reservation.id,
    event: "reservation fulfilled",
    id: input.reservation.id,
    properties: {
      ...reservationProperties(input.reservation),
      dotypos_customer_id: input.reservation.dotyposCustomerId,
      dotypos_reservation_id:
        input.reservation.dotyposReservationId ?? undefined,
    },
    timestamp: input.timestamp,
  });

export const capturePaymentStarted = (input: {
  readonly attempt: PaymentLifecycleAttempt;
  readonly timestamp: LifecycleEventTimestamp;
}) =>
  captureLifecycleEvent({
    distinctId: input.attempt.workspaceReservationId,
    event: "payment started",
    id: input.attempt.id,
    properties: paymentProperties(input.attempt),
    timestamp: input.timestamp,
  });

export const capturePaymentCompleted = (input: {
  readonly attempt: PaymentLifecycleAttempt;
  readonly timestamp: LifecycleEventTimestamp;
}) =>
  captureLifecycleEvent({
    distinctId: input.attempt.workspaceReservationId,
    event: "payment completed",
    id: input.attempt.id,
    properties: paymentProperties(input.attempt),
    timestamp: input.timestamp,
  });

export const capturePaymentAbandoned = (input: {
  readonly attempt: PaymentLifecycleAttempt;
  readonly timestamp: LifecycleEventTimestamp;
}) =>
  captureLifecycleEvent({
    distinctId: input.attempt.workspaceReservationId,
    event: "payment abandoned",
    id: input.attempt.id,
    properties: paymentProperties(input.attempt),
    timestamp: input.timestamp,
  });

export const capturePaymentFailed = (input: {
  readonly attempt: PaymentLifecycleAttempt;
  readonly failureReason: "nexi_hpp_create_failed" | "nexi_payment_failed";
  readonly timestamp: LifecycleEventTimestamp;
}) =>
  captureLifecycleEvent({
    distinctId: input.attempt.workspaceReservationId,
    event: "payment failed",
    id: input.attempt.id,
    properties: {
      ...paymentProperties(input.attempt),
      failure_reason: input.failureReason,
    },
    timestamp: input.timestamp,
  });
