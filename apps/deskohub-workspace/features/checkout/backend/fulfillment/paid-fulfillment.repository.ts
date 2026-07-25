import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type PaidFulfillmentJob,
  paidFulfillmentJobs,
  paidFulfillmentMaxAttempts,
  paymentAttempts,
  paymentPaidEvents,
  workspaceReservations,
} from "@/db/schema";

export interface PaidFulfillmentRepository {
  readonly reconcilePaidReservations: (input: {
    readonly limit: number;
  }) => Effect.Effect<number, EffectDrizzleQueryError>;
  readonly retireExhaustedLeases: (input: {
    readonly staleBefore: Temporal.Instant;
    readonly now: Temporal.Instant;
  }) => Effect.Effect<number, EffectDrizzleQueryError>;
  readonly selectDispatchable: (input: {
    readonly now: Temporal.Instant;
    readonly staleBefore: Temporal.Instant;
    readonly limit: number;
  }) => Effect.Effect<readonly PaidFulfillmentJob[], EffectDrizzleQueryError>;
  readonly claim: (input: {
    readonly id: string;
    readonly ownerId: string;
    readonly now: Temporal.Instant;
    readonly staleBefore: Temporal.Instant;
  }) => Effect.Effect<PaidFulfillmentJob | null, EffectDrizzleQueryError>;
  readonly markCompleted: (input: {
    readonly id: string;
    readonly ownerId: string;
    readonly completedAt: Temporal.Instant;
  }) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  readonly markAttemptFailed: (input: {
    readonly id: string;
    readonly ownerId: string;
    readonly failedAt: Temporal.Instant;
    readonly nextAttemptAt: Temporal.Instant;
    readonly failureCode: string;
  }) => Effect.Effect<"lost" | "manual" | "retry", EffectDrizzleQueryError>;
}

export const PaidFulfillmentRepository =
  Context.Service<PaidFulfillmentRepository>("PaidFulfillmentRepository");

export const PaidFulfillmentRepositoryLive = Layer.effect(
  PaidFulfillmentRepository,
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;

    return PaidFulfillmentRepository.of({
      reconcilePaidReservations: Effect.fn(
        "PaidFulfillmentRepository.reconcilePaidReservations"
      )(function* ({ limit }) {
        const candidates = yield* db
          .select({
            paymentAttemptId: paymentAttempts.id,
            workspaceReservationId: workspaceReservations.id,
            paidAt: workspaceReservations.paidAt,
          })
          .from(workspaceReservations)
          .innerJoin(
            paymentAttempts,
            eq(workspaceReservations.activePaymentAttemptId, paymentAttempts.id)
          )
          .where(
            and(
              eq(workspaceReservations.paymentState, "paid"),
              inArray(workspaceReservations.fulfillmentState, [
                "not_started",
                "processing",
                "failed",
              ]),
              eq(paymentAttempts.state, "paid")
            )
          )
          .orderBy(
            asc(workspaceReservations.paidAt),
            asc(workspaceReservations.id)
          )
          .limit(limit);

        yield* Effect.forEach(
          candidates,
          ({ paidAt, ...candidate }) =>
            paidAt
              ? db
                  .insert(paymentPaidEvents)
                  .values({ ...candidate, paidAt })
                  .onConflictDoNothing({
                    target: paymentPaidEvents.paymentAttemptId,
                  })
                  .returning({ id: paymentPaidEvents.id })
              : Effect.succeed([]),
          { concurrency: "inherit" }
        );

        const events = yield* db
          .select({
            paymentPaidEventId: paymentPaidEvents.id,
            workspaceReservationId: paymentPaidEvents.workspaceReservationId,
          })
          .from(paymentPaidEvents)
          .innerJoin(
            workspaceReservations,
            eq(
              paymentPaidEvents.workspaceReservationId,
              workspaceReservations.id
            )
          )
          .where(
            inArray(workspaceReservations.fulfillmentState, [
              "not_started",
              "processing",
              "failed",
            ])
          )
          .orderBy(asc(paymentPaidEvents.paidAt), asc(paymentPaidEvents.id))
          .limit(limit);

        const insertedJobs = yield* Effect.forEach(
          events,
          (event) =>
            db
              .insert(paidFulfillmentJobs)
              .values(event)
              .onConflictDoNothing({
                target: paidFulfillmentJobs.paymentPaidEventId,
              })
              .returning({ id: paidFulfillmentJobs.id }),
          { concurrency: "inherit" }
        );

        return insertedJobs.reduce((count, rows) => count + rows.length, 0);
      }),
      retireExhaustedLeases: Effect.fn(
        "PaidFulfillmentRepository.retireExhaustedLeases"
      )(function* ({ now, staleBefore }) {
        const retired = yield* db
          .update(paidFulfillmentJobs)
          .set({
            state: "manual",
            leaseOwnerId: null,
            claimedAt: null,
            failureCode: "paid_fulfillment_attempts_exhausted",
            updatedAt: now,
          })
          .where(
            and(
              eq(paidFulfillmentJobs.state, "processing"),
              lte(paidFulfillmentJobs.claimedAt, staleBefore),
              eq(paidFulfillmentJobs.attemptCount, paidFulfillmentMaxAttempts)
            )
          )
          .returning({ id: paidFulfillmentJobs.id });

        return retired.length;
      }),
      selectDispatchable: Effect.fn(
        "PaidFulfillmentRepository.selectDispatchable"
      )(function* ({ limit, now, staleBefore }) {
        return yield* db
          .select()
          .from(paidFulfillmentJobs)
          .where(
            and(
              inArray(paidFulfillmentJobs.state, ["pending", "processing"]),
              lte(
                paidFulfillmentJobs.attemptCount,
                paidFulfillmentMaxAttempts - 1
              ),
              or(
                and(
                  eq(paidFulfillmentJobs.state, "pending"),
                  lte(paidFulfillmentJobs.nextAttemptAt, now)
                ),
                and(
                  eq(paidFulfillmentJobs.state, "processing"),
                  lte(paidFulfillmentJobs.claimedAt, staleBefore)
                )
              )
            )
          )
          .orderBy(
            asc(paidFulfillmentJobs.nextAttemptAt),
            asc(paidFulfillmentJobs.createdAt),
            asc(paidFulfillmentJobs.id)
          )
          .limit(limit);
      }),
      claim: Effect.fn("PaidFulfillmentRepository.claim")(function* ({
        id,
        now,
        ownerId,
        staleBefore,
      }) {
        const [claimed] = yield* db
          .update(paidFulfillmentJobs)
          .set({
            state: "processing",
            attemptCount: sql`${paidFulfillmentJobs.attemptCount} + 1`,
            leaseOwnerId: ownerId,
            claimedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(paidFulfillmentJobs.id, id),
              lte(
                paidFulfillmentJobs.attemptCount,
                paidFulfillmentMaxAttempts - 1
              ),
              or(
                and(
                  eq(paidFulfillmentJobs.state, "pending"),
                  lte(paidFulfillmentJobs.nextAttemptAt, now)
                ),
                and(
                  eq(paidFulfillmentJobs.state, "processing"),
                  lte(paidFulfillmentJobs.claimedAt, staleBefore)
                )
              )
            )
          )
          .returning();

        return claimed ?? null;
      }),
      markCompleted: Effect.fn("PaidFulfillmentRepository.markCompleted")(
        function* ({ completedAt, id, ownerId }) {
          const completed = yield* db
            .update(paidFulfillmentJobs)
            .set({
              state: "completed",
              leaseOwnerId: null,
              claimedAt: null,
              completedAt,
              failureCode: null,
              updatedAt: completedAt,
            })
            .where(
              and(
                eq(paidFulfillmentJobs.id, id),
                eq(paidFulfillmentJobs.state, "processing"),
                eq(paidFulfillmentJobs.leaseOwnerId, ownerId)
              )
            )
            .returning({ id: paidFulfillmentJobs.id });

          return completed.length > 0;
        }
      ),
      markAttemptFailed: Effect.fn(
        "PaidFulfillmentRepository.markAttemptFailed"
      )(function* ({ failedAt, failureCode, id, nextAttemptAt, ownerId }) {
        const [current] = yield* db
          .select({ attemptCount: paidFulfillmentJobs.attemptCount })
          .from(paidFulfillmentJobs)
          .where(
            and(
              eq(paidFulfillmentJobs.id, id),
              eq(paidFulfillmentJobs.state, "processing"),
              eq(paidFulfillmentJobs.leaseOwnerId, ownerId)
            )
          )
          .limit(1);
        if (!current) return "lost";

        const state =
          current.attemptCount >= paidFulfillmentMaxAttempts
            ? ("manual" as const)
            : ("pending" as const);
        const updated = yield* db
          .update(paidFulfillmentJobs)
          .set({
            state,
            leaseOwnerId: null,
            claimedAt: null,
            nextAttemptAt,
            failureCode,
            updatedAt: failedAt,
          })
          .where(
            and(
              eq(paidFulfillmentJobs.id, id),
              eq(paidFulfillmentJobs.state, "processing"),
              eq(paidFulfillmentJobs.leaseOwnerId, ownerId)
            )
          )
          .returning({ id: paidFulfillmentJobs.id });

        return updated.length === 0
          ? "lost"
          : state === "manual"
            ? "manual"
            : "retry";
      }),
    });
  })
);
