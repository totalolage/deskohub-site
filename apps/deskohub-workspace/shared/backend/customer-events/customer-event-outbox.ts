import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { customerEvents } from "@/db/schema/customer-events";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { reservationCustomerEventKinds } from "./customer-event";

/**
 * A customer event as its writer records it: the kind, when it happened and
 * the ids it concerns. It never carries reservation state or profile values.
 */
export type NewCustomerEvent = (
  | {
      readonly kind: (typeof reservationCustomerEventKinds)[number];
      readonly occurredAt: Temporal.Instant;
      readonly dotyposCustomerId: DotyposCustomerId;
      readonly workspaceReservationId: WorkspaceReservationId;
    }
  | {
      readonly kind: "account-created";
      readonly occurredAt: Temporal.Instant;
      readonly dotyposCustomerId: DotyposCustomerId;
      readonly customerAccountId: CustomerAccountId;
    }
) & {
  /** When the writer recorded it; the database's clock when omitted. */
  readonly recordedAt?: Temporal.Instant;
};

/**
 * Records the event through the caller's transaction executor, so it commits
 * or rolls back with the write it describes. The `customer_events` unique
 * indexes make a retried write, or one the capture reconciler already
 * recorded, a no-op.
 */
export const recordCustomerEvent = (
  executor: WorkspaceDatabaseClient,
  event: NewCustomerEvent
): Effect.Effect<void, EffectDrizzleQueryError> =>
  executor
    .insert(customerEvents)
    .values(event)
    .onConflictDoNothing()
    .pipe(Effect.asVoid);
