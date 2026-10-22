import {
  and,
  eq,
  isNotNull,
  isNull,
  not,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { paymentAttempts, workspaceReservations } from "@/db/schema";
import { temporalInstantToDate } from "@/shared/utils/temporal";
import type { AdministrationReservationStatusFilter } from "./administration.service";

/** The states a status group reads, each as a SQL condition. */
type ReservationStates = {
  readonly confirmed: SQL;
  readonly cancelled: SQL;
  readonly holdExpired: SQL;
  readonly fulfilled: SQL;
  readonly fulfillmentFailed: SQL;
};

const currentStates: ReservationStates = {
  confirmed: isNotNull(workspaceReservations.reservationConfirmedAt),
  cancelled: eq(workspaceReservations.reservationState, "cancelled"),
  holdExpired: eq(workspaceReservations.reservationState, "hold_expired"),
  fulfilled: eq(workspaceReservations.fulfillmentState, "fulfilled"),
  fulfillmentFailed: eq(workspaceReservations.fulfillmentState, "failed"),
};

/**
 * The states as the stored transition timestamps date them at `asOf`: a
 * state entered later hadn't happened yet. A legacy row without the
 * timestamp keeps its current state, which {@link undatedStatusChangeAt}
 * reports.
 */
const statesAsOf = (asOf: Temporal.Instant): ReservationStates => {
  const by = (instant: SQLWrapper) =>
    sql`${instant} <= ${temporalInstantToDate(asOf)}`;
  const enteredBy = (state: SQL, enteredAt: SQLWrapper) =>
    and(state, or(sql`${enteredAt} is null`, by(enteredAt)))!;
  return {
    confirmed: by(workspaceReservations.reservationConfirmedAt),
    cancelled: enteredBy(
      currentStates.cancelled,
      workspaceReservations.reservationCancelledAt
    ),
    holdExpired: enteredBy(
      currentStates.holdExpired,
      sql`coalesce(${workspaceReservations.reservationHoldExpiredAt}, ${workspaceReservations.reservationHoldExpiresAt})`
    ),
    fulfilled: enteredBy(
      currentStates.fulfilled,
      workspaceReservations.fulfilledAt
    ),
    fulfillmentFailed: enteredBy(
      currentStates.fulfillmentFailed,
      workspaceReservations.fulfillmentFailedAt
    ),
  };
};

const statesAt = (asOf: Temporal.Instant | undefined) =>
  asOf ? statesAsOf(asOf) : currentStates;

/** Cancellation in progress or failed: undated, so read as it is now. */
const cancellationUnsettled = sql`${workspaceReservations.reservationState} in ('cancelling', 'cancellation_failed')`;

const notCancelled = (states: ReservationStates) =>
  and(not(states.cancelled), not(cancellationUnsettled))!;

const neitherFulfilledNorFailed = (states: ReservationStates) =>
  and(
    not(states.fulfillmentFailed),
    not(states.fulfilled),
    sql`${workspaceReservations.reservationState} <> 'cancellation_failed'`
  )!;

const successful = (states: ReservationStates) =>
  and(states.fulfilled, notCancelled(states))!;

const booked = (states: ReservationStates) =>
  and(states.confirmed, notCancelled(states))!;

/** A reservation the customer received: fulfilled and never cancelled. */
export const successfulReservationCondition = successful(currentStates);

/**
 * A reservation the customer booked: confirmed and never cancelled, whether or
 * not fulfillment succeeded. Abandoned and expired checkouts never confirm.
 */
export const bookedReservationCondition = booked(currentStates);

/**
 * A reservation booked as it stood at `asOf`: confirmed by then and not
 * cancelled by then. Without an instant, as it stands now.
 */
export const bookedReservationConditionAt = (asOf?: Temporal.Instant): SQL =>
  booked(statesAt(asOf));

const needsRefundCondition = sql`exists (
  select 1 from ${paymentAttempts}
  where ${paymentAttempts.workspaceReservationId} = ${workspaceReservations.id}
    and ${paymentAttempts.refundState} = 'required'
)`;

/**
 * SQL condition selecting Workspace reservations in an operator-facing status
 * group, so every reservation filter shares the admin status vocabulary.
 * Given `asOf`, the group the reservation was in then, as far as the stored
 * transition timestamps date it; {@link undatedStatusChangeAt} reports the
 * reservations where they can't.
 */
export const reservationStatusCondition = (
  status: AdministrationReservationStatusFilter,
  asOf?: Temporal.Instant
): SQL => {
  const states = statesAt(asOf);
  if (status === "needs_refund") {
    return needsRefundCondition;
  }
  if (status === "complete") {
    return successful(states);
  }
  if (status === "cancelled") {
    return and(
      neitherFulfilledNorFailed(states),
      or(states.cancelled, states.holdExpired)
    )!;
  }
  return and(
    neitherFulfilledNorFailed(states),
    not(states.cancelled),
    not(states.holdExpired)
  )!;
};

/** A status group a reservation condition reads, or `booked` without one. */
export type ReservationStatusRead =
  | AdministrationReservationStatusFilter
  | "booked";

/**
 * When the reservation last changed in a way the stored timestamps can't
 * date for these statuses, or null. Before that instant, a condition as of
 * an earlier moment reads the reservation's current state, or guesses the
 * state before a dated one, so the result is approximate:
 *
 * - a cancellation in progress or failed, and a cancelled or expired legacy
 *   row without its timestamp, are dated only by the row's last update;
 * - for the groups that read fulfillment, a failure erases the fulfillment
 *   it may have followed, and a retry of a failed fulfillment, or a recovery
 *   from one, which keeps the failure's time, is dated only by the row's
 *   last update;
 * - a refund requirement carries no timestamp of its own.
 *
 * Not reported: a failure recovered before recoveries kept its time reads
 * as still in progress then.
 */
export const undatedStatusChangeAt = (
  statuses: ReadonlySet<ReservationStatusRead>
): SQL => {
  const readsCancellation = [...statuses].some(
    (status) => status !== "needs_refund"
  );
  const readsFulfillment = [...statuses].some(
    (status) =>
      status === "complete" ||
      status === "cancelled" ||
      status === "in_progress"
  );
  const changes = [
    readsCancellation &&
      sql`case when ${or(
        cancellationUnsettled,
        and(
          currentStates.cancelled,
          isNull(workspaceReservations.reservationCancelledAt)
        ),
        and(
          currentStates.holdExpired,
          isNull(workspaceReservations.reservationHoldExpiredAt),
          isNull(workspaceReservations.reservationHoldExpiresAt)
        )
      )} then ${workspaceReservations.updatedAt} end`,
    readsFulfillment &&
      sql`case
        when ${currentStates.fulfillmentFailed} then ${workspaceReservations.fulfillmentFailedAt}
        when ${workspaceReservations.fulfillmentFailedAt} is not null then ${workspaceReservations.updatedAt}
      end`,
    statuses.has("needs_refund") &&
      sql`(
        select max(${paymentAttempts.updatedAt}) from ${paymentAttempts}
        where ${paymentAttempts.workspaceReservationId} = ${workspaceReservations.id}
          and ${paymentAttempts.refundState} <> 'not_required'
      )`,
  ].filter((change): change is SQL => change !== false);
  return changes.length === 0
    ? sql`null`
    : sql`greatest(${sql.join(changes, sql`, `)})`;
};
