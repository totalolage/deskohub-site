import { Cache, Context, Duration, Effect, Exit, Layer, Option } from "effect";
import type { WorkspaceReservationRow } from "@/db/schema";
import type { PaymentAttempt } from "@/features/checkout/backend/repositories/payment-attempt.repository";
import type { CheckoutAttemptId } from "@/features/checkout/checkout-identifiers";
import type { ReservationLifecycleEvent } from "@/features/checkout/reservation-lifecycle-events";
import type {
  ReservationAvailabilityResult,
  ReservationPrePaymentOutcome,
} from "@/features/reservation/reservation-analytics";
import {
  ServerAnalytics,
  type ServerEventProperties,
} from "@/shared/backend/analytics/server-analytics.service";
import { catchRecoverableCause } from "@/shared/backend/workspace-effect";
import { moneyMajorAmount } from "@/shared/money/money";
import { ReservationAnalyticsPerson } from "./reservation-analytics-person";

type CheckoutEventTimestamp = WorkspaceReservationRow["createdAt"];

type LifecycleReservation = Pick<WorkspaceReservationRow, "id">;

type PaymentLifecycleAttempt = Pick<
  PaymentAttempt,
  "amount" | "id" | "provider" | "workspaceReservationId"
>;

interface ReservationEventInput {
  readonly reservation: LifecycleReservation;
  readonly timestamp: CheckoutEventTimestamp;
}

interface PaymentEventInput {
  readonly attempt: PaymentLifecycleAttempt;
  readonly timestamp: CheckoutEventTimestamp;
}

type PaymentFailureReason =
  | "nexi_hpp_create_failed"
  | "nexi_hpp_create_unconfirmed"
  | "nexi_payment_failed";

/**
 * The checkout's analytics. Reservation and payment lifecycle events go out
 * regardless of consent: under the author's account person while the
 * author's current analytics consent decision is a grant, otherwise under
 * the reservation's ID with no person. The inputs take only the reservation
 * ID and the payment attempt fields they send. Request events go out only for
 * the request's consented visitor. Every operation is best effort and never
 * fails.
 */
export interface ICheckoutAnalytics {
  readonly reservationStarted: (
    input: ReservationEventInput
  ) => Effect.Effect<void>;
  readonly reservationAbandoned: (
    input: ReservationEventInput
  ) => Effect.Effect<void>;
  readonly reservationCompleted: (
    input: ReservationEventInput
  ) => Effect.Effect<void>;
  readonly reservationFulfilled: (
    input: ReservationEventInput
  ) => Effect.Effect<void>;
  readonly paymentStarted: (input: PaymentEventInput) => Effect.Effect<void>;
  readonly paymentCompleted: (input: PaymentEventInput) => Effect.Effect<void>;
  readonly paymentAbandoned: (input: PaymentEventInput) => Effect.Effect<void>;
  readonly paymentFailed: (
    input: PaymentEventInput & { readonly failureReason: PaymentFailureReason }
  ) => Effect.Effect<void>;
  readonly availabilityResult: (input: {
    readonly checkoutAttemptId: CheckoutAttemptId;
    readonly result: ReservationAvailabilityResult;
    readonly timestamp: CheckoutEventTimestamp;
  }) => Effect.Effect<void>;
  readonly prePaymentOutcome: (input: {
    readonly checkoutAttemptId: CheckoutAttemptId;
    readonly outcome: ReservationPrePaymentOutcome;
    readonly timestamp: CheckoutEventTimestamp;
  }) => Effect.Effect<void>;
}

export class CheckoutAnalytics extends Context.Service<
  CheckoutAnalytics,
  ICheckoutAnalytics
>()("@deskohub-workspace/checkout/CheckoutAnalytics") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const analytics = yield* ServerAnalytics;
      const person = yield* ReservationAnalyticsPerson;

      // Read once per reservation for the run this layer is built for, so
      // a withdrawal applies from the next request on. A failed read isn't
      // kept, so the next event reads again.
      const linkedAccounts = yield* Cache.makeWith(person.linkedAccount, {
        capacity: Number.POSITIVE_INFINITY,
        timeToLive: (exit) =>
          Exit.isSuccess(exit) ? Duration.infinity : Duration.zero,
      });

      /**
       * The account the reservation's events join; none, so the event goes
       * out without a person, when its author's consent can't be read.
       * Payment, webhook, and fulfillment work captures on its way, so no
       * failure of the read, a defect included, fails it.
       */
      const linkedAccount = Effect.fn("CheckoutAnalytics.linkedAccount")(
        (
          reservationId: LifecycleReservation["id"],
          _event: ReservationLifecycleEvent
        ) => Cache.get(linkedAccounts, reservationId),
        (effect, _reservationId, event) =>
          effect.pipe(
            catchRecoverableCause((cause) =>
              Effect.as(
                Effect.logWarning(
                  "Lifecycle event captured without a person: the author's analytics consent couldn't be read",
                  { event, cause }
                ),
                Option.none()
              )
            )
          )
      );

      const captureLifecycleEvent = Effect.fnUntraced(function* (input: {
        readonly event: ReservationLifecycleEvent;
        readonly reservationId: LifecycleReservation["id"];
        readonly occurrenceId: string;
        readonly properties: ServerEventProperties;
        readonly timestamp: CheckoutEventTimestamp;
      }) {
        const account = yield* linkedAccount(input.reservationId, input.event);
        yield* analytics.capture({
          name: input.event,
          subject: Option.match(account, {
            onNone: () => ({
              kind: "record" as const,
              recordId: input.reservationId,
              occurrenceId: input.occurrenceId,
            }),
            onSome: (accountId) => ({
              kind: "account" as const,
              accountId,
              occurrenceId: input.occurrenceId,
            }),
          }),
          properties: input.properties,
          timestamp: input.timestamp,
        });
      });

      const reservationEvent =
        (event: ReservationLifecycleEvent) =>
        ({ reservation, timestamp }: ReservationEventInput) =>
          captureLifecycleEvent({
            event,
            reservationId: reservation.id,
            occurrenceId: reservation.id,
            properties: { reservation_id: reservation.id },
            timestamp,
          });

      const paymentEvent =
        (event: ReservationLifecycleEvent) =>
        (
          { attempt, timestamp }: PaymentEventInput,
          properties: ServerEventProperties = {}
        ) =>
          captureLifecycleEvent({
            event,
            reservationId: attempt.workspaceReservationId,
            occurrenceId: attempt.id,
            properties: { ...paymentProperties(attempt), ...properties },
            timestamp,
          });

      const captureRequestEvent = (input: {
        readonly event: string;
        readonly checkoutAttemptId: CheckoutAttemptId;
        readonly result: string;
        readonly properties: ServerEventProperties;
        readonly timestamp: CheckoutEventTimestamp;
      }) =>
        analytics.capture({
          name: input.event,
          subject: {
            kind: "visitor",
            occurrenceId: input.checkoutAttemptId,
            result: input.result,
          },
          properties: input.properties,
          timestamp: input.timestamp,
        });

      const paymentFailed = paymentEvent("payment failed");

      return {
        reservationStarted: reservationEvent("reservation started"),
        reservationAbandoned: reservationEvent("reservation abandoned"),
        reservationCompleted: reservationEvent("reservation completed"),
        reservationFulfilled: reservationEvent("reservation fulfilled"),
        paymentStarted: paymentEvent("payment started"),
        paymentCompleted: paymentEvent("payment completed"),
        paymentAbandoned: paymentEvent("payment abandoned"),
        paymentFailed: ({ failureReason, ...input }) =>
          paymentFailed(input, { failure_reason: failureReason }),
        availabilityResult: ({ checkoutAttemptId, result, timestamp }) =>
          captureRequestEvent({
            event: "availability result",
            checkoutAttemptId,
            result,
            properties: { result },
            timestamp,
          }),
        prePaymentOutcome: ({ checkoutAttemptId, outcome, timestamp }) =>
          captureRequestEvent({
            event: "pre-payment outcome",
            checkoutAttemptId,
            result: outcome,
            properties: { outcome },
            timestamp,
          }),
      };
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(ServerAnalytics.Live, ReservationAnalyticsPerson.Live)
    )
  );
}

const paymentProperties = (
  attempt: PaymentLifecycleAttempt
): ServerEventProperties => ({
  currency: attempt.amount.currency,
  revenue: moneyMajorAmount(attempt.amount),
  reservation_id: attempt.workspaceReservationId,
  payment_attempt_id: attempt.id,
  provider: attempt.provider,
});
