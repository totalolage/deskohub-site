import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import {
  type DatabaseError,
  runDb,
  WorkspaceDatabase,
} from "@/db/database.service";
import { type WorkspaceReservation, workspaceReservations } from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";

export class WorkspaceReservationStateError extends Data.TaggedError(
  "WorkspaceReservationStateError"
)<{
  readonly operation: string;
  readonly reservationId: string;
  readonly message: string;
}> {}

export interface CreateWorkspaceReservationInput {
  readonly reservationIntentKey: string;
  readonly dotyposCustomerId: string;
  readonly customerAccessCode: string;
  readonly productTier: string;
  readonly productCoffee: boolean;
  readonly productMonitorOption?: string;
  readonly locale: string;
  readonly reservationHoldExpiresAt?: Date;
}

export interface WorkspaceReservationRepository {
  readonly createDraft: (
    input: CreateWorkspaceReservationInput
  ) => Effect.Effect<WorkspaceReservation, DatabaseError>;
  readonly findById: (
    id: string
  ) => Effect.Effect<WorkspaceReservation | null, DatabaseError>;
  readonly findByIntentKey: (
    reservationIntentKey: string
  ) => Effect.Effect<WorkspaceReservation | null, DatabaseError>;
  readonly updateProductIntent: (input: {
    readonly id: string;
    readonly productTier: string;
    readonly productCoffee: boolean;
    readonly productMonitorOption?: string;
    readonly locale: string;
  }) => Effect.Effect<
    WorkspaceReservation,
    DatabaseError | WorkspaceReservationStateError
  >;
  readonly claimHoldCreation: (
    id: string
  ) => Effect.Effect<boolean, DatabaseError>;
  readonly releaseHoldCreation: (
    id: string
  ) => Effect.Effect<void, DatabaseError | WorkspaceReservationStateError>;
  readonly attachHold: (input: {
    readonly id: string;
    readonly dotyposReservationId: string;
    readonly reservationCreatedAt: Date;
    readonly reservationHoldExpiresAt: Date;
  }) => Effect.Effect<void, DatabaseError | WorkspaceReservationStateError>;
  readonly markAttachFailedCancellationRequired: (input: {
    readonly id: string;
    readonly dotyposReservationId: string;
    readonly reservationCreatedAt: Date;
    readonly failureCode: string;
  }) => Effect.Effect<void, DatabaseError | WorkspaceReservationStateError>;
  readonly claimCancellation: (
    id: string
  ) => Effect.Effect<WorkspaceReservation | null, DatabaseError>;
  readonly markCancelled: (input: {
    readonly id: string;
    readonly cancelledAt: Date;
    readonly holdExpiredAt?: Date;
  }) => Effect.Effect<void, DatabaseError | WorkspaceReservationStateError>;
  readonly markCancellationFailed: (input: {
    readonly id: string;
    readonly failureCode: string;
  }) => Effect.Effect<void, DatabaseError | WorkspaceReservationStateError>;
  readonly recordHoldCleanupSkipped: (input: {
    readonly id: string;
    readonly holdExpiredAt: Date;
    readonly failureCode: string;
  }) => Effect.Effect<void, DatabaseError | WorkspaceReservationStateError>;
  readonly markPaymentPaid: (input: {
    readonly id: string;
    readonly paymentAttemptId: string;
    readonly paidAt: Date;
  }) => Effect.Effect<void, DatabaseError | WorkspaceReservationStateError>;
  readonly markPaymentTerminal: (input: {
    readonly id: string;
    readonly paymentAttemptId: string;
    readonly paymentState: "failed" | "cancelled" | "expired";
    readonly failureCode: string;
  }) => Effect.Effect<void, DatabaseError | WorkspaceReservationStateError>;
  readonly claimPaidFulfillment: (input: {
    readonly id: string;
    readonly staleProcessingBefore: Date;
  }) => Effect.Effect<WorkspaceReservation | null, DatabaseError>;
  readonly markFulfilled: (input: {
    readonly id: string;
    readonly fulfilledAt: Date;
  }) => Effect.Effect<void, DatabaseError | WorkspaceReservationStateError>;
  readonly markFulfillmentFailed: (input: {
    readonly id: string;
    readonly failureCode: string;
    readonly failedAt: Date;
  }) => Effect.Effect<void, DatabaseError | WorkspaceReservationStateError>;
  readonly markFulfillmentDeliveryFailed: (input: {
    readonly id: string;
    readonly failureCode: string;
    readonly failedAt: Date;
  }) => Effect.Effect<void, DatabaseError | WorkspaceReservationStateError>;
  readonly markReservationConfirmed: (input: {
    readonly id: string;
    readonly confirmedAt: Date;
  }) => Effect.Effect<void, DatabaseError | WorkspaceReservationStateError>;
  readonly selectExpiredHolds: (input: {
    readonly now: Date;
    readonly limit: number;
  }) => Effect.Effect<readonly WorkspaceReservation[], DatabaseError>;
  readonly selectExpiredHoldDotyposReservationIds: (input: {
    readonly now: Date;
  }) => Effect.Effect<readonly string[], DatabaseError>;
}

export const WorkspaceReservationRepository =
  Context.Service<WorkspaceReservationRepository>(
    "WorkspaceReservationRepository"
  );

const ensureUpdated = (
  updated: readonly Pick<WorkspaceReservation, "id">[],
  operation: string,
  reservationId: string,
  message: string
) =>
  updated.length > 0
    ? Effect.void
    : Effect.fail(
        new WorkspaceReservationStateError({
          operation,
          reservationId,
          message,
        })
      );

export const WorkspaceReservationRepositoryLive = Layer.effect(
  WorkspaceReservationRepository,
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;

    const findById = Effect.fn("workspaceReservations.findById")(
      function* (id: string) {
        return yield* runDb("workspaceReservations.findById", async () => {
          const [reservation] = await db
            .select()
            .from(workspaceReservations)
            .where(eq(workspaceReservations.id, id))
            .limit(1);
          return reservation ?? null;
        });
      },
      (effect, reservationId) =>
        effect.pipe(Effect.annotateLogs({ reservationId }))
    );

    return WorkspaceReservationRepository.of({
      createDraft: Effect.fn("workspaceReservations.createDraft")(
        function* (input) {
          const row = {
            id: postgresUuidV7,
            reservationIntentKey: input.reservationIntentKey,
            correlationId: postgresUuidV7,
            dotyposCustomerId: input.dotyposCustomerId,
            customerAccessCode: input.customerAccessCode,
            reservationState: "draft" as const,
            paymentState: "not_started" as const,
            fulfillmentState: "not_started" as const,
            productTier: input.productTier,
            productCoffee: input.productCoffee,
            productMonitorOption: input.productMonitorOption,
            locale: input.locale,
            reservationHoldExpiresAt: input.reservationHoldExpiresAt,
          };

          return yield* runDb("workspaceReservations.createDraft", async () => {
            const [inserted] = await db
              .insert(workspaceReservations)
              .values(row)
              .onConflictDoNothing()
              .returning();

            if (inserted) return inserted;

            const [existing] = await db
              .select()
              .from(workspaceReservations)
              .where(
                eq(
                  workspaceReservations.reservationIntentKey,
                  input.reservationIntentKey
                )
              )
              .limit(1);

            if (!existing)
              throw new Error("Workspace reservation insert returned no row");
            return existing;
          });
        },
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({
              reservationIntentKey: input.reservationIntentKey,
              dotyposCustomerId: input.dotyposCustomerId,
            })
          )
      ),
      findById,
      findByIntentKey: Effect.fn("workspaceReservations.findByIntentKey")(
        function* (reservationIntentKey) {
          return yield* runDb(
            "workspaceReservations.findByIntentKey",
            async () => {
              const [reservation] = await db
                .select()
                .from(workspaceReservations)
                .where(
                  eq(
                    workspaceReservations.reservationIntentKey,
                    reservationIntentKey
                  )
                )
                .limit(1);
              return reservation ?? null;
            }
          );
        },
        (effect, reservationIntentKey) =>
          effect.pipe(Effect.annotateLogs({ reservationIntentKey }))
      ),
      updateProductIntent: Effect.fn(
        "workspaceReservations.updateProductIntent"
      )(function* (input) {
        const updated = yield* runDb(
          "workspaceReservations.updateProductIntent",
          () =>
            db
              .update(workspaceReservations)
              .set({
                productTier: input.productTier,
                productCoffee: input.productCoffee,
                productMonitorOption: input.productMonitorOption ?? null,
                locale: input.locale,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  inArray(workspaceReservations.reservationState, [
                    "draft",
                    "held",
                  ])
                )
              )
              .returning()
        );
        if (!updated[0]) {
          return yield* Effect.fail(
            new WorkspaceReservationStateError({
              operation: "workspaceReservations.updateProductIntent",
              reservationId: input.id,
              message:
                "Only draft or held reservations can refresh product intent.",
            })
          );
        }
        return updated[0];
      }),
      claimHoldCreation: Effect.fn("workspaceReservations.claimHoldCreation")(
        function* (id) {
          const updated = yield* runDb(
            "workspaceReservations.claimHoldCreation",
            () =>
              db
                .update(workspaceReservations)
                .set({
                  reservationState: "creating_hold",
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(workspaceReservations.id, id),
                    eq(workspaceReservations.reservationState, "draft")
                  )
                )
                .returning({ id: workspaceReservations.id })
          );
          return updated.length > 0;
        },
        (effect, reservationId) =>
          effect.pipe(Effect.annotateLogs({ reservationId }))
      ),
      releaseHoldCreation: Effect.fn(
        "workspaceReservations.releaseHoldCreation"
      )(function* (id) {
        const updated = yield* runDb(
          "workspaceReservations.releaseHoldCreation",
          () =>
            db
              .update(workspaceReservations)
              .set({ reservationState: "draft", updatedAt: new Date() })
              .where(
                and(
                  eq(workspaceReservations.id, id),
                  eq(workspaceReservations.reservationState, "creating_hold"),
                  sql`${workspaceReservations.dotyposReservationId} is null`
                )
              )
              .returning({ id: workspaceReservations.id })
        );
        yield* ensureUpdated(
          updated,
          "workspaceReservations.releaseHoldCreation",
          id,
          "Only unattached creating_hold reservations can be released."
        );
      }),
      attachHold: Effect.fn("workspaceReservations.attachHold")(
        function* (input) {
          const updated = yield* runDb("workspaceReservations.attachHold", () =>
            db
              .update(workspaceReservations)
              .set({
                dotyposReservationId: input.dotyposReservationId,
                reservationState: "held",
                reservationCreatedAt: input.reservationCreatedAt,
                reservationHoldExpiresAt: input.reservationHoldExpiresAt,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.reservationState, "creating_hold")
                )
              )
              .returning({ id: workspaceReservations.id })
          );
          yield* ensureUpdated(
            updated,
            "workspaceReservations.attachHold",
            input.id,
            "Only creating_hold reservations can attach a Dotypos hold."
          );
        }
      ),
      markAttachFailedCancellationRequired: Effect.fn(
        "workspaceReservations.markAttachFailedCancellationRequired"
      )(function* (input) {
        const updated = yield* runDb(
          "workspaceReservations.markAttachFailedCancellationRequired",
          () =>
            db
              .update(workspaceReservations)
              .set({
                dotyposReservationId: input.dotyposReservationId,
                reservationCreatedAt: input.reservationCreatedAt,
                reservationState: "cancellation_failed",
                failureCode: input.failureCode,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.reservationState, "creating_hold")
                )
              )
              .returning({ id: workspaceReservations.id })
        );
        yield* ensureUpdated(
          updated,
          "workspaceReservations.markAttachFailedCancellationRequired",
          input.id,
          "Only creating_hold reservations can record attach-cancel recovery."
        );
      }),
      claimCancellation: Effect.fn("workspaceReservations.claimCancellation")(
        function* (id) {
          return yield* runDb(
            "workspaceReservations.claimCancellation",
            async () => {
              const [claimed] = await db
                .update(workspaceReservations)
                .set({ reservationState: "cancelling", updatedAt: new Date() })
                .where(
                  and(
                    eq(workspaceReservations.id, id),
                    inArray(workspaceReservations.reservationState, [
                      "held",
                      "hold_expired",
                      "cancellation_failed",
                    ]),
                    sql`${workspaceReservations.paymentState} <> 'paid'`,
                    sql`${workspaceReservations.reservationState} <> 'confirmed'`
                  )
                )
                .returning();
              return claimed ?? null;
            }
          );
        }
      ),
      markCancelled: Effect.fn("workspaceReservations.markCancelled")(
        function* (input) {
          const updated = yield* runDb(
            "workspaceReservations.markCancelled",
            () =>
              db
                .update(workspaceReservations)
                .set({
                  reservationState: "cancelled",
                  reservationCancelledAt: input.cancelledAt,
                  reservationHoldExpiredAt: input.holdExpiredAt,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(workspaceReservations.id, input.id),
                    eq(workspaceReservations.reservationState, "cancelling"),
                    sql`${workspaceReservations.paymentState} <> 'paid'`,
                    sql`${workspaceReservations.reservationConfirmedAt} is null`
                  )
                )
                .returning({ id: workspaceReservations.id })
          );
          yield* ensureUpdated(
            updated,
            "workspaceReservations.markCancelled",
            input.id,
            "Only unpaid cancelling reservations can be marked cancelled."
          );
        }
      ),
      markCancellationFailed: Effect.fn(
        "workspaceReservations.markCancellationFailed"
      )(function* (input) {
        const updated = yield* runDb(
          "workspaceReservations.markCancellationFailed",
          () =>
            db
              .update(workspaceReservations)
              .set({
                reservationState: "cancellation_failed",
                failureCode: input.failureCode,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.reservationState, "cancelling"),
                  sql`${workspaceReservations.paymentState} <> 'paid'`
                )
              )
              .returning({ id: workspaceReservations.id })
        );
        yield* ensureUpdated(
          updated,
          "workspaceReservations.markCancellationFailed",
          input.id,
          "Workspace reservation was not found."
        );
      }),
      recordHoldCleanupSkipped: Effect.fn(
        "workspaceReservations.recordHoldCleanupSkipped"
      )(function* (input) {
        const updated = yield* runDb(
          "workspaceReservations.recordHoldCleanupSkipped",
          () =>
            db
              .update(workspaceReservations)
              .set({
                reservationHoldExpiredAt: input.holdExpiredAt,
                failureCode: input.failureCode,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.reservationState, "held"),
                  sql`${workspaceReservations.paymentState} <> 'paid'`,
                  lte(
                    workspaceReservations.reservationHoldExpiresAt,
                    input.holdExpiredAt
                  )
                )
              )
              .returning({ id: workspaceReservations.id })
        );
        yield* ensureUpdated(
          updated,
          "workspaceReservations.recordHoldCleanupSkipped",
          input.id,
          "Only unpaid expired held reservations can record skipped cleanup."
        );
      }),
      markPaymentPaid: Effect.fn("workspaceReservations.markPaymentPaid")(
        function* (input) {
          const updated = yield* runDb(
            "workspaceReservations.markPaymentPaid",
            () =>
              db
                .update(workspaceReservations)
                .set({
                  paymentState: "paid",
                  paidAt: input.paidAt,
                  failureCode: null,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(workspaceReservations.id, input.id),
                    eq(workspaceReservations.reservationState, "held"),
                    eq(workspaceReservations.paymentState, "pending"),
                    eq(
                      workspaceReservations.activePaymentAttemptId,
                      input.paymentAttemptId
                    )
                  )
                )
                .returning({ id: workspaceReservations.id })
          );
          yield* ensureUpdated(
            updated,
            "workspaceReservations.markPaymentPaid",
            input.id,
            "Only the active pending attempt on a held reservation can mark payment paid."
          );
        }
      ),
      markPaymentTerminal: Effect.fn(
        "workspaceReservations.markPaymentTerminal"
      )(function* (input) {
        const updated = yield* runDb(
          "workspaceReservations.markPaymentTerminal",
          () =>
            db
              .update(workspaceReservations)
              .set({
                paymentState: input.paymentState,
                failureCode: input.failureCode,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.reservationState, "held"),
                  eq(workspaceReservations.paymentState, "pending"),
                  eq(
                    workspaceReservations.activePaymentAttemptId,
                    input.paymentAttemptId
                  )
                )
              )
              .returning({ id: workspaceReservations.id })
        );
        yield* ensureUpdated(
          updated,
          "workspaceReservations.markPaymentTerminal",
          input.id,
          "Only the active pending attempt on a held reservation can mark payment terminal."
        );
      }),
      claimPaidFulfillment: Effect.fn(
        "workspaceReservations.claimPaidFulfillment"
      )(function* (input) {
        return yield* runDb(
          "workspaceReservations.claimPaidFulfillment",
          async () => {
            const [claimed] = await db
              .update(workspaceReservations)
              .set({ fulfillmentState: "processing", updatedAt: new Date() })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.paymentState, "paid"),
                  or(
                    inArray(workspaceReservations.fulfillmentState, [
                      "not_started",
                      "failed",
                    ]),
                    and(
                      eq(workspaceReservations.fulfillmentState, "processing"),
                      lte(
                        workspaceReservations.updatedAt,
                        input.staleProcessingBefore
                      )
                    )
                  )
                )
              )
              .returning();
            return claimed ?? null;
          }
        );
      }),
      markFulfilled: Effect.fn("workspaceReservations.markFulfilled")(
        function* (input) {
          const updated = yield* runDb(
            "workspaceReservations.markFulfilled",
            () =>
              db
                .update(workspaceReservations)
                .set({
                  fulfillmentState: "fulfilled",
                  fulfilledAt: input.fulfilledAt,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(workspaceReservations.id, input.id),
                    eq(workspaceReservations.paymentState, "paid"),
                    eq(workspaceReservations.fulfillmentState, "processing")
                  )
                )
                .returning({ id: workspaceReservations.id })
          );
          yield* ensureUpdated(
            updated,
            "workspaceReservations.markFulfilled",
            input.id,
            "Only processing paid reservations can be marked fulfilled."
          );
        }
      ),
      markFulfillmentFailed: Effect.fn(
        "workspaceReservations.markFulfillmentFailed"
      )(function* (input) {
        const updated = yield* runDb(
          "workspaceReservations.markFulfillmentFailed",
          () =>
            db
              .update(workspaceReservations)
              .set({
                fulfillmentState: "failed",
                fulfillmentFailedAt: input.failedAt,
                fulfillmentFailureCode: input.failureCode,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.paymentState, "paid"),
                  eq(workspaceReservations.fulfillmentState, "processing")
                )
              )
              .returning({ id: workspaceReservations.id })
        );
        yield* ensureUpdated(
          updated,
          "workspaceReservations.markFulfillmentFailed",
          input.id,
          "Only processing paid reservations can be marked fulfillment failed."
        );
      }),
      markFulfillmentDeliveryFailed: Effect.fn(
        "workspaceReservations.markFulfillmentDeliveryFailed"
      )(function* (input) {
        const updated = yield* runDb(
          "workspaceReservations.markFulfillmentDeliveryFailed",
          () =>
            db
              .update(workspaceReservations)
              .set({
                fulfillmentState: "failed",
                fulfilledAt: null,
                fulfillmentFailedAt: input.failedAt,
                fulfillmentFailureCode: input.failureCode,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.paymentState, "paid"),
                  inArray(workspaceReservations.fulfillmentState, [
                    "processing",
                    "fulfilled",
                  ])
                )
              )
              .returning({ id: workspaceReservations.id })
        );
        yield* ensureUpdated(
          updated,
          "workspaceReservations.markFulfillmentDeliveryFailed",
          input.id,
          "Only processing or fulfilled paid reservations can be marked delivery failed."
        );
      }),
      markReservationConfirmed: Effect.fn(
        "workspaceReservations.markReservationConfirmed"
      )(function* (input) {
        const updated = yield* runDb(
          "workspaceReservations.markReservationConfirmed",
          () =>
            db
              .update(workspaceReservations)
              .set({
                reservationState: "confirmed",
                reservationConfirmedAt: input.confirmedAt,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.reservationState, "held"),
                  eq(workspaceReservations.paymentState, "paid"),
                  eq(workspaceReservations.fulfillmentState, "processing")
                )
              )
              .returning({ id: workspaceReservations.id })
        );
        yield* ensureUpdated(
          updated,
          "workspaceReservations.markReservationConfirmed",
          input.id,
          "Only processing paid held reservations can be marked confirmed."
        );
      }),
      selectExpiredHolds: Effect.fn("workspaceReservations.selectExpiredHolds")(
        function* (input) {
          return yield* runDb("workspaceReservations.selectExpiredHolds", () =>
            db
              .select()
              .from(workspaceReservations)
              .where(
                and(
                  eq(workspaceReservations.reservationState, "held"),
                  sql`${workspaceReservations.paymentState} <> 'paid'`,
                  lte(workspaceReservations.reservationHoldExpiresAt, input.now)
                )
              )
              .orderBy(
                sql`coalesce(${workspaceReservations.reservationHoldExpiredAt}, ${workspaceReservations.reservationHoldExpiresAt})`,
                asc(workspaceReservations.reservationHoldExpiresAt),
                asc(workspaceReservations.id)
              )
              .limit(input.limit)
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),
      selectExpiredHoldDotyposReservationIds: Effect.fn(
        "workspaceReservations.selectExpiredHoldDotyposReservationIds"
      )(function* (input) {
        const rows = yield* runDb(
          "workspaceReservations.selectExpiredHoldDotyposReservationIds",
          () =>
            db
              .select({
                dotyposReservationId:
                  workspaceReservations.dotyposReservationId,
              })
              .from(workspaceReservations)
              .where(
                and(
                  eq(workspaceReservations.reservationState, "held"),
                  inArray(workspaceReservations.paymentState, [
                    "not_started",
                    "failed",
                    "cancelled",
                    "expired",
                  ]),
                  sql`${workspaceReservations.dotyposReservationId} is not null`,
                  lte(workspaceReservations.reservationHoldExpiresAt, input.now)
                )
              )
        );

        return rows.flatMap(({ dotyposReservationId }) =>
          dotyposReservationId ? [dotyposReservationId] : []
        );
      }),
    });
  })
);
