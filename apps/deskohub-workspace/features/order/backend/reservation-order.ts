import { eq } from "drizzle-orm";
import { Effect } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import {
  orders,
  paymentAttempts,
  type WorkspaceReservation,
  workspaceReservations,
} from "@/db/schema";
import { orderIdSchema } from "../order";

type TransactionClient = Parameters<
  Parameters<WorkspaceDatabaseClient["transaction"]>[0]
>[0];

/**
 * Anchors a reservation-only write on its current payment attempt before the
 * caller locks or updates the reservation. Deployed recovery writers may hold
 * that attempt FOR UPDATE before waiting on the reservation; taking this
 * NO KEY UPDATE lock first makes the writers serialize without a cycle, while
 * remaining compatible with the order FK's KEY SHARE check.
 */
export const lockReservationActivePaymentAttempt = Effect.fn(
  "orders.lockReservationActivePaymentAttempt"
)(function* (input: {
  readonly tx: TransactionClient;
  readonly reservationId: WorkspaceReservation["id"];
}) {
  const [reservation] = yield* input.tx
    .select({
      activePaymentAttemptId: workspaceReservations.activePaymentAttemptId,
    })
    .from(workspaceReservations)
    .where(eq(workspaceReservations.id, input.reservationId))
    .limit(1);

  if (!reservation?.activePaymentAttemptId) return;

  yield* input.tx
    .select({ id: paymentAttempts.id })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.id, reservation.activePaymentAttemptId))
    .limit(1)
    .for("no key update");
});

/**
 * Mirrors the authoritative reservation row into its reservation-kind order
 * (orders.id = reservation.id) inside the caller's transaction. The
 * reservation stays the source of truth; the order is the mirrored ledger, so
 * the upsert overwrites every mirrored column with the reservation's facts and
 * never revives an order of another kind.
 */
export const ensureReservationOrder = Effect.fn(
  "orders.ensureReservationOrder"
)(function* (input: {
  readonly tx: TransactionClient;
  readonly reservation: WorkspaceReservation;
}) {
  const orderId = orderIdSchema.make(input.reservation.id);
  const values = {
    id: orderId,
    kind: "reservation" as const,
    correlationId: input.reservation.correlationId,
    dotyposCustomerId: input.reservation.dotyposCustomerId,
    paymentState: input.reservation.paymentState,
    fulfillmentState: input.reservation.fulfillmentState,
    activePaymentAttemptId: input.reservation.activePaymentAttemptId,
    paidAt: input.reservation.paidAt,
    fulfilledAt: input.reservation.fulfilledAt,
    fulfillmentFailedAt: input.reservation.fulfillmentFailedAt,
    fulfillmentFailureCode: input.reservation.fulfillmentFailureCode,
    createdAt: input.reservation.createdAt,
    updatedAt: input.reservation.updatedAt,
  };

  const [order] = yield* input.tx
    .insert(orders)
    .values(values)
    .onConflictDoUpdate({
      target: orders.id,
      set: values,
      setWhere: eq(orders.kind, "reservation"),
    })
    .returning();

  // Lock-order contract: this mirror is reservation → order only. It must
  // never touch payment_attempts: reservation-first writers may run while a
  // payment writer holds the attempt row lock (the attempt-first anchor
  // matches the deployed old writers), and any attempt access here would
  // invert that order into a rolling-deploy deadlock. Legacy attempt relink
  // (order_id NULL → reservation id) belongs to the attempt-first payment
  // writers, which already hold the attempt row lock.
  if (!order) {
    return yield* Effect.die(
      `Order ${orderId} already exists with a non-reservation kind.`
    );
  }

  return order;
});
