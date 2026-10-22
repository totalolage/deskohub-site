import { Match } from "effect";
import type {
  FulfillmentState,
  PaymentState,
} from "@/db/schema/workspace-reservations";
import {
  type CustomerReservationHistory,
  type CustomerReservationProduct,
  type CustomerReservationStatus,
  type CustomerReservationSummary,
  groupCustomerReservations,
} from "@/features/account/contracts";
import type {
  CheckoutStatusKind,
  CheckoutStatusReturnOutcome,
  CheckoutStatusViewModel,
} from "@/features/checkout/backend/checkout/checkout-status.service";
import type { ReviewSandboxReservation } from "./review-sandbox-reservation";

type ReservationState = ReviewSandboxReservation["state"];

const historyStatuses = {
  open: "pending",
  cancelled: "cancelled",
  expired: "cancelled",
  completed: "confirmed",
} as const satisfies Record<ReservationState, CustomerReservationStatus>;

const toHistoryProduct = (
  details: ReviewSandboxReservation["details"]
): CustomerReservationProduct =>
  Match.value(details).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ entryTier }): CustomerReservationProduct => ({
        kind: "cowork",
        tier: entryTier,
      }),
      "meeting-room": (): CustomerReservationProduct => ({
        kind: "meeting-room",
      }),
      office: (): CustomerReservationProduct => ({ kind: "office" }),
    })
  );

const toHistorySummary = (
  reservation: ReviewSandboxReservation
): CustomerReservationSummary => ({
  id: reservation.orderId,
  workspaceReservationId: reservation.orderId,
  reviewSandbox: true,
  product: toHistoryProduct(reservation.details),
  startsAt: reservation.startsAt.toString(),
  endsAt: reservation.endsAt.toString(),
  seats: reservation.seats,
  status: historyStatuses[reservation.state],
});

/** A review account's sandbox reservations as its history, newest start first. */
export const toReviewSandboxHistory = (
  reservations: readonly ReviewSandboxReservation[],
  now: Temporal.Instant
): CustomerReservationHistory => ({
  kind: "available",
  groups: groupCustomerReservations(
    reservations
      .toSorted((a, b) => Temporal.Instant.compare(b.startsAt, a.startsAt))
      .map(toHistorySummary),
    now
  ),
});

/**
 * How each sandbox state reads on the status page: an open hold awaits a
 * payment it never gets, and a sample is a confirmed booking.
 */
const statusStates = {
  open: {
    status: "created",
    paymentStatus: "not_started",
    fulfillmentStatus: "not_started",
  },
  cancelled: {
    status: "cancelled",
    paymentStatus: "cancelled",
    fulfillmentStatus: "not_started",
  },
  expired: {
    status: "expired",
    paymentStatus: "expired",
    fulfillmentStatus: "not_started",
  },
  completed: {
    status: "fulfilled",
    paymentStatus: "paid",
    fulfillmentStatus: "fulfilled",
  },
} as const satisfies Record<
  ReservationState,
  {
    readonly status: Exclude<CheckoutStatusKind, "not_found">;
    readonly paymentStatus: PaymentState;
    readonly fulfillmentStatus: FulfillmentState;
  }
>;

/** A sandbox reservation as its status page shows it, without access. */
export const toReviewSandboxStatus = (
  reservation: ReviewSandboxReservation,
  returnOutcome: CheckoutStatusReturnOutcome
): CheckoutStatusViewModel => {
  const view = {
    orderId: reservation.orderId,
    returnOutcome,
    reviewSandbox: true as const,
    ...statusStates[reservation.state],
  };
  const summary = {
    price: reservation.total,
    reservedFrom: reservation.startsAt,
    reservedUntil: reservation.endsAt,
  };
  return Match.value(reservation.details).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (details): CheckoutStatusViewModel => ({
        ...view,
        kind: "cowork",
        summary: { ...summary, ...details },
      }),
      "meeting-room": (details): CheckoutStatusViewModel => ({
        ...view,
        kind: "meeting-room",
        summary: { ...summary, ...details },
      }),
      office: (details): CheckoutStatusViewModel => ({
        ...view,
        kind: "office",
        summary: { ...summary, ...details, seats: reservation.seats },
      }),
    })
  );
};
