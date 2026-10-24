import "@/shared/polyfills/temporal";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, asc, eq, gte, isNotNull, notExists, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  customerAccounts,
  customerEvents,
  workspaceReservations,
} from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import { currentInstant } from "@/shared/utils/temporal";
import type { CustomerEventKind } from "./customer-event";

/** How many events of each kind one reconciliation inserts. */
export const customerEventReconcileBatchSize = 500;

/**
 * How far back reconciliation looks. It covers the 30-day replay, the 7-day
 * late-payment queue retention and the gap between a migration and its
 * promotion, and stays under the 90-day event retention.
 */
const customerEventReconcileWindow = Temporal.Duration.from({
  hours: 35 * 24,
});

/** How many missing events of each kind one reconciliation recorded. */
export type CustomerEventReconciliation = {
  readonly booked: number;
  readonly cancelled: number;
  readonly accountCreated: number;
};

interface ICustomerEventReconciler {
  /**
   * Records the booked, cancelled and account-created events that a writer
   * without the outbox missed, oldest first and bounded per kind. Each
   * reconciled event keeps the time it happened, and the unique indexes make
   * a race with the outbox a no-op.
   */
  readonly reconcile: Effect.Effect<
    CustomerEventReconciliation,
    EffectDrizzleQueryError
  >;
}

/**
 * Captures the events that Workspace writes without the outbox, such as an
 * older deployment still serving or consuming queued messages, would miss.
 * It reads local tables only.
 */
export class CustomerEventReconciler extends Context.Service<
  CustomerEventReconciler,
  ICustomerEventReconciler
>()("@deskohub-workspace/customer-events/CustomerEventReconciler") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const recordedEvent = (kind: CustomerEventKind) =>
        db
          .select({ id: customerEvents.id })
          .from(customerEvents)
          .where(
            and(
              eq(customerEvents.kind, kind),
              eq(
                customerEvents.workspaceReservationId,
                workspaceReservations.id
              )
            )
          );

      const reconcileBooked = (since: Temporal.Instant) =>
        db
          .insert(customerEvents)
          .select(
            db
              .select({
                kind: eventKind("reservation-booked"),
                occurredAt: workspaceReservations.reservationConfirmedAt,
                dotyposCustomerId: workspaceReservations.dotyposCustomerId,
                workspaceReservationId: workspaceReservations.id,
              })
              .from(workspaceReservations)
              .where(
                and(
                  gte(workspaceReservations.reservationConfirmedAt, since),
                  notExists(recordedEvent("reservation-booked"))
                )
              )
              .orderBy(asc(workspaceReservations.reservationConfirmedAt))
              .limit(customerEventReconcileBatchSize)
          )
          .onConflictDoNothing()
          .returning({ id: customerEvents.id });

      const reconcileCancelled = (since: Temporal.Instant) =>
        db
          .insert(customerEvents)
          .select(
            db
              .select({
                kind: eventKind("reservation-cancelled"),
                occurredAt: workspaceReservations.reservationCancelledAt,
                dotyposCustomerId: workspaceReservations.dotyposCustomerId,
                workspaceReservationId: workspaceReservations.id,
              })
              .from(workspaceReservations)
              .where(
                and(
                  // Only a booked reservation's cancellation is an event.
                  isNotNull(workspaceReservations.reservationConfirmedAt),
                  gte(workspaceReservations.reservationCancelledAt, since),
                  notExists(recordedEvent("reservation-cancelled"))
                )
              )
              .orderBy(asc(workspaceReservations.reservationCancelledAt))
              .limit(customerEventReconcileBatchSize)
          )
          .onConflictDoNothing()
          .returning({ id: customerEvents.id });

      const reconcileAccountCreated = (since: Temporal.Instant) =>
        db
          .insert(customerEvents)
          .select(
            db
              .select({
                kind: eventKind("account-created"),
                occurredAt: customerAccounts.createdAt,
                dotyposCustomerId:
                  sql<DotyposCustomerId>`${customerAccounts.dotyposCustomerId}`.as(
                    "dotypos_customer_id"
                  ),
                customerAccountId: customerAccounts.id,
              })
              .from(customerAccounts)
              // A backfilled login stays silent until its owner verifies it.
              .innerJoin(authUser, eq(authUser.id, customerAccounts.id))
              .where(
                and(
                  isNotNull(customerAccounts.dotyposCustomerId),
                  gte(customerAccounts.createdAt, since),
                  // An existing customer's account is never a new one (D37).
                  eq(customerAccounts.legacy, false),
                  eq(authUser.emailVerified, true),
                  notExists(
                    db
                      .select({ id: customerEvents.id })
                      .from(customerEvents)
                      .where(
                        and(
                          eq(customerEvents.kind, "account-created"),
                          eq(
                            customerEvents.customerAccountId,
                            customerAccounts.id
                          )
                        )
                      )
                  )
                )
              )
              .orderBy(asc(customerAccounts.createdAt))
              .limit(customerEventReconcileBatchSize)
          )
          .onConflictDoNothing()
          .returning({ id: customerEvents.id });

      const reconcile = Effect.gen(function* () {
        const since = (yield* currentInstant).subtract(
          customerEventReconcileWindow
        );
        const booked = yield* reconcileBooked(since);
        const cancelled = yield* reconcileCancelled(since);
        const accountCreated = yield* reconcileAccountCreated(since);
        const reconciliation: CustomerEventReconciliation = {
          booked: booked.length,
          cancelled: cancelled.length,
          accountCreated: accountCreated.length,
        };
        return reconciliation;
      }).pipe(Effect.withSpan("CustomerEventReconciler.reconcile"));

      return { reconcile } satisfies ICustomerEventReconciler;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

const eventKind = (kind: CustomerEventKind) =>
  sql<CustomerEventKind>`${kind}`.as("kind");
