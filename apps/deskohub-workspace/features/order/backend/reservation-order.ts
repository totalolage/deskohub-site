import { eq } from "drizzle-orm";
import { Effect } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { orders, type WorkspaceReservation } from "@/db/schema";
import { orderIdSchema } from "../order";

type TransactionClient = Parameters<
  Parameters<WorkspaceDatabaseClient["transaction"]>[0]
>[0];

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

  if (order) return order;

  return yield* Effect.die(
    `Order ${orderId} already exists with a non-reservation kind.`
  );
});
