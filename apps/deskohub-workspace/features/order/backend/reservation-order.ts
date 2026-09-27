import { eq } from "drizzle-orm";
import { Effect } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { orders, type WorkspaceReservation } from "@/db/schema";
import { orderIdSchema } from "../order";

type TransactionClient = Parameters<
  Parameters<WorkspaceDatabaseClient["transaction"]>[0]
>[0];

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

  // Lock-order contract: this mirror is reservation → order only. It never
  // touches payment_attempts; active_payment_attempt_id is a mirrored scalar
  // without a database FK so reservation writes remain compatible with old
  // settlement readers. Payment writers maintain application-level attempt
  // linkage transactionally.
  if (!order) {
    return yield* Effect.die(
      `Order ${orderId} already exists with a non-reservation kind.`
    );
  }

  return order;
});
