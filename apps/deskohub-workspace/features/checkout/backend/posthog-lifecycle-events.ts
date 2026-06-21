import { Effect } from "effect";
import type { PaymentAttempt, WorkspaceReservation } from "@/db/schema";
import {
  type PostHogEventProperties,
  PostHogEventService,
} from "@/shared/backend/analytics/posthog-event.service";

const reservationProperties = (
  reservation: Pick<WorkspaceReservation, "id">
): PostHogEventProperties => ({
  reservation_id: reservation.id,
  workspace_reservation_id: reservation.id,
});

type PaymentLifecycleAttempt = Pick<
  PaymentAttempt,
  | "amountExponent"
  | "amountValue"
  | "currency"
  | "id"
  | "providerOrderId"
  | "workspaceReservationId"
>;

const paymentProperties = (
  attempt: PaymentLifecycleAttempt
): PostHogEventProperties => ({
  amount: attempt.amountValue / 10 ** attempt.amountExponent,
  amount_exponent: attempt.amountExponent,
  amount_value: attempt.amountValue,
  currency: attempt.currency,
  reservation_id: attempt.workspaceReservationId,
  payment_attempt_id: attempt.id,
  provider_order_id: attempt.providerOrderId,
});

const captureLifecycleEvent = (input: {
  readonly distinctId: string;
  readonly event: string;
  readonly id: string;
  readonly properties: PostHogEventProperties;
  readonly timestamp: Date;
}) =>
  Effect.gen(function* () {
    const posthog = yield* PostHogEventService;
    yield* posthog.capture({
      distinctId: input.distinctId,
      event: input.event,
      properties: input.properties,
      timestamp: input.timestamp,
      uuid: `${input.id}:${input.event}`,
    });
  });

export const captureReservationStarted = (input: {
  readonly reservation: Pick<
    WorkspaceReservation,
    "id" | "dotyposReservationId"
  >;
  readonly timestamp: Date;
}) =>
  captureLifecycleEvent({
    distinctId: input.reservation.id,
    event: "reservation started",
    id: input.reservation.id,
    properties: {
      ...reservationProperties(input.reservation),
      ...(input.reservation.dotyposReservationId
        ? { dotypos_reservation_id: input.reservation.dotyposReservationId }
        : {}),
    },
    timestamp: input.timestamp,
  });

export const captureReservationAbandoned = (input: {
  readonly reservation: Pick<
    WorkspaceReservation,
    "id" | "dotyposReservationId"
  >;
  readonly timestamp: Date;
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
  readonly timestamp: Date;
}) =>
  captureLifecycleEvent({
    distinctId: input.reservation.id,
    event: "reservation completed",
    id: input.reservation.id,
    properties: {
      ...reservationProperties(input.reservation),
      ...(input.reservation.dotyposReservationId
        ? { dotypos_reservation_id: input.reservation.dotyposReservationId }
        : {}),
    },
    timestamp: input.timestamp,
  });

export const captureReservationFulfilled = (input: {
  readonly reservation: Pick<
    WorkspaceReservation,
    "id" | "dotyposCustomerId" | "dotyposReservationId"
  >;
  readonly timestamp: Date;
}) =>
  captureLifecycleEvent({
    distinctId: input.reservation.id,
    event: "reservation fulfilled",
    id: input.reservation.id,
    properties: {
      ...reservationProperties(input.reservation),
      dotypos_customer_id: input.reservation.dotyposCustomerId,
      ...(input.reservation.dotyposReservationId
        ? { dotypos_reservation_id: input.reservation.dotyposReservationId }
        : {}),
    },
    timestamp: input.timestamp,
  });

export const capturePaymentStarted = (input: {
  readonly attempt: PaymentLifecycleAttempt;
  readonly timestamp: Date;
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
  readonly timestamp: Date;
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
  readonly timestamp: Date;
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
  readonly failureCode: string;
  readonly failureReason: string;
  readonly timestamp: Date;
}) =>
  captureLifecycleEvent({
    distinctId: input.attempt.workspaceReservationId,
    event: "payment failed",
    id: input.attempt.id,
    properties: {
      ...paymentProperties(input.attempt),
      failure_code: input.failureCode,
      failure_reason: input.failureReason,
    },
    timestamp: input.timestamp,
  });
