import type { EmailDeliveryId } from "@deskohub/email";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { retryDatabaseRead } from "@/db/retry-database-read";
import {
  type LatePaymentRecoveryState,
  latePaymentRecoveries,
  type WorkspaceReservationRow,
  workspaceReservations,
} from "@/db/schema";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationDetailsMalformedError } from "@/features/reservation/backend/stored-reservation-details.server";
import {
  decodeOptionalWorkspaceReservation,
  ensureUpdated,
  type WorkspaceReservation,
  type WorkspaceReservationStateError,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

export interface PaidFulfillmentProgress
  extends Pick<
    WorkspaceReservationRow,
    "paymentState" | "reservationState" | "fulfillmentState"
  > {
  /** The unrecovered recovery of the active payment attempt, if any. */
  readonly latePaymentRecoveryState: LatePaymentRecoveryState | null;
}

export const fulfillmentEmailFailureCode = "fulfillment_email_failed";

/**
 * A delivery recording or retention arrived for an email idempotency
 * generation that another writer already closed by recording its accepted
 * send, so the writer must adopt the newer generation instead of touching it.
 */
export class WorkspaceReservationDeliveryGenerationSupersededError extends Data.TaggedError(
  "WorkspaceReservationDeliveryGenerationSupersededError"
)<{
  readonly operation: string;
  readonly reservationId: WorkspaceReservationId;
  readonly expectedActiveCustomerEmailDeliveryId: EmailDeliveryId | null;
  readonly activeCustomerEmailDeliveryId: EmailDeliveryId | null;
}> {}

export interface IFulfillmentLedger {
  readonly claimPaidFulfillment: (input: {
    readonly id: WorkspaceReservationId;
    readonly staleProcessingBefore: Temporal.Instant;
  }) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  /**
   * The states that decide whether paid fulfillment can still progress,
   * including the late-payment recovery that blocks its claim, if any.
   */
  readonly findPaidFulfillmentProgress: (
    id: WorkspaceReservationId
  ) => Effect.Effect<PaidFulfillmentProgress | null, EffectDrizzleQueryError>;
  readonly findByActiveCustomerEmailDeliveryId: (
    customerEmailDeliveryId: EmailDeliveryId
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly retainActiveCustomerEmailDeliveryLocale: (input: {
    readonly id: WorkspaceReservationId;
    readonly locale: Locale;
    readonly expectedActiveCustomerEmailDeliveryId: EmailDeliveryId | null;
  }) => Effect.Effect<Locale | null, EffectDrizzleQueryError>;
  readonly markAwaitingCustomerEmailDelivery: (input: {
    readonly id: WorkspaceReservationId;
    readonly customerEmailDeliveryId: EmailDeliveryId;
    readonly expectedActiveCustomerEmailDeliveryId: EmailDeliveryId | null;
  }) => Effect.Effect<
    void,
    | EffectDrizzleQueryError
    | WorkspaceReservationDeliveryGenerationSupersededError
    | WorkspaceReservationStateError
  >;
  readonly markCustomerEmailDeliveryFulfilled: (input: {
    readonly customerEmailDeliveryId: EmailDeliveryId;
    readonly fulfilledAt: Temporal.Instant;
  }) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly markCustomerEmailDeliveryFailed: (input: {
    readonly customerEmailDeliveryId: EmailDeliveryId;
    readonly failureCode: string;
    readonly failedAt: Temporal.Instant;
  }) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  /**
   * Completes fulfillment on provider acceptance. The accepted send replaces
   * any earlier delivery ID, so webhooks for a superseded send cannot match.
   */
  readonly markFulfilled: (input: {
    readonly id: WorkspaceReservationId;
    readonly fulfilledAt: Temporal.Instant;
    readonly customerEmailDeliveryId: EmailDeliveryId;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly markFulfillmentFailed: (input: {
    readonly id: WorkspaceReservationId;
    readonly failureCode: string;
    readonly failedAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly selectStalledPaidFulfillments: (input: {
    readonly updatedBefore: Temporal.Instant;
    readonly limit: number;
  }) => Effect.Effect<
    readonly WorkspaceReservationId[],
    EffectDrizzleQueryError
  >;
}

/**
 * The persisted progress of paid fulfillment: the claim, the customer
 * confirmation's delivery generations, and the outcomes that settle a run.
 * Internal to the fulfillment module; its state machine is the Fulfillment
 * state in the checkout lifecycle reference.
 *
 * A claim retakes a `processing` run whose `updatedAt` is at or before
 * `staleProcessingBefore`, never an `awaiting_delivery` one. `markFulfilled`
 * and `markFulfillmentFailed` fence on state alone, not on the claim, so a
 * stalled run that was reclaimed can still settle it. Change that only
 * together with the invoice delivery lease's fence.
 */
export class FulfillmentLedger extends Context.Service<
  FulfillmentLedger,
  IFulfillmentLedger
>()("FulfillmentLedger") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      // A paid reservation whose active attempt is under late-payment
      // recovery is fulfilled by that recovery, not by paid fulfillment.
      const isFulfillmentBlockingLatePaymentRecovery = () =>
        and(
          eq(
            latePaymentRecoveries.workspaceReservationId,
            workspaceReservations.id
          ),
          eq(
            latePaymentRecoveries.paymentAttemptId,
            workspaceReservations.activePaymentAttemptId
          ),
          ne(latePaymentRecoveries.state, "recovered")
        );
      const isOutsideLatePaymentRecovery = () =>
        notExists(
          db
            .select({
              paymentAttemptId: latePaymentRecoveries.paymentAttemptId,
            })
            .from(latePaymentRecoveries)
            .where(isFulfillmentBlockingLatePaymentRecovery())
        );

      return {
        claimPaidFulfillment: Effect.fn(
          "workspaceReservations.claimPaidFulfillment"
        )(function* (input) {
          const [claimed] = yield* db
            .update(workspaceReservations)
            .set({
              fulfillmentState: "processing",
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.paymentState, "paid"),
                inArray(workspaceReservations.reservationState, [
                  "held",
                  "confirmed",
                ]),
                isOutsideLatePaymentRecovery(),
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
          return yield* decodeOptionalWorkspaceReservation(claimed);
        }),
        findPaidFulfillmentProgress: Effect.fn(
          "workspaceReservations.findPaidFulfillmentProgress"
        )(
          function* (id) {
            const [progress] = yield* db
              .select({
                paymentState: workspaceReservations.paymentState,
                reservationState: workspaceReservations.reservationState,
                fulfillmentState: workspaceReservations.fulfillmentState,
                latePaymentRecoveryState: latePaymentRecoveries.state,
              })
              .from(workspaceReservations)
              .leftJoin(
                latePaymentRecoveries,
                isFulfillmentBlockingLatePaymentRecovery()
              )
              .where(eq(workspaceReservations.id, id))
              .limit(1);
            return progress ?? null;
          },
          (effect, reservationId) =>
            effect.pipe(Effect.annotateLogs({ reservationId }))
        ),
        findByActiveCustomerEmailDeliveryId: Effect.fn(
          "workspaceReservations.findByActiveCustomerEmailDeliveryId"
        )(
          function* (customerEmailDeliveryId) {
            const [reservation] = yield* db
              .select()
              .from(workspaceReservations)
              .where(
                eq(
                  workspaceReservations.activeCustomerEmailDeliveryId,
                  customerEmailDeliveryId
                )
              )
              .limit(1);
            return yield* decodeOptionalWorkspaceReservation(reservation);
          },
          (effect, customerEmailDeliveryId) =>
            effect.pipe(Effect.annotateLogs({ customerEmailDeliveryId }))
        ),
        retainActiveCustomerEmailDeliveryLocale: Effect.fn(
          "workspaceReservations.retainActiveCustomerEmailDeliveryLocale"
        )(function* (input) {
          // Both statements are bound to the claimed delivery generation via
          // its active-delivery marker, so a writer whose generation was
          // recorded (or advanced) while it stalled can neither seed nor
          // borrow another generation's locale slot. Only the first send of a
          // generation may seed the slot, so a later attempt can never
          // overwrite the locale behind an existing idempotency key.
          const generationStillActive =
            input.expectedActiveCustomerEmailDeliveryId === null
              ? isNull(workspaceReservations.activeCustomerEmailDeliveryId)
              : eq(
                  workspaceReservations.activeCustomerEmailDeliveryId,
                  input.expectedActiveCustomerEmailDeliveryId
                );
          // A writer that loses the null-slot race receives the
          // already-retained locale so its send matches the generation.
          const [seeded] = yield* db
            .update(workspaceReservations)
            .set({
              activeCustomerEmailDeliveryLocale: input.locale,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                isNull(workspaceReservations.activeCustomerEmailDeliveryLocale),
                generationStillActive
              )
            )
            .returning({
              locale: workspaceReservations.activeCustomerEmailDeliveryLocale,
            });
          if (seeded) return seeded.locale;
          const [retained] = yield* db
            .select({
              locale: workspaceReservations.activeCustomerEmailDeliveryLocale,
            })
            .from(workspaceReservations)
            .where(
              and(eq(workspaceReservations.id, input.id), generationStillActive)
            )
            .limit(1);
          // Null means the claimed generation is closed: another writer
          // recorded its accepted send between the claim and this retention.
          return retained?.locale ?? null;
        }),
        markAwaitingCustomerEmailDelivery: Effect.fn(
          "workspaceReservations.markAwaitingCustomerEmailDelivery"
        )(function* (input) {
          // The expected prior delivery ID binds the recording to the
          // generation the writer claimed, so a delayed recording from an old
          // generation can never overwrite a newer generation's delivery ID
          // or clear its retained locale.
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              fulfillmentState: "awaiting_delivery",
              activeCustomerEmailDeliveryId: input.customerEmailDeliveryId,
              // Recording the accepted send closes its idempotency generation,
              // so the next generation resolves the current preference again.
              activeCustomerEmailDeliveryLocale: null,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.paymentState, "paid"),
                eq(workspaceReservations.fulfillmentState, "processing"),
                input.expectedActiveCustomerEmailDeliveryId === null
                  ? isNull(workspaceReservations.activeCustomerEmailDeliveryId)
                  : eq(
                      workspaceReservations.activeCustomerEmailDeliveryId,
                      input.expectedActiveCustomerEmailDeliveryId
                    )
              )
            )
            .returning({ id: workspaceReservations.id });
          if (updated.length > 0) return;
          // Distinguish verified generation supersession from other
          // invalid-state failures so callers only treat supersession as a
          // benign no-op.
          const [current] = yield* db
            .select({
              activeCustomerEmailDeliveryId:
                workspaceReservations.activeCustomerEmailDeliveryId,
            })
            .from(workspaceReservations)
            .where(eq(workspaceReservations.id, input.id))
            .limit(1);
          if (
            current &&
            current.activeCustomerEmailDeliveryId !==
              input.expectedActiveCustomerEmailDeliveryId
          ) {
            return yield* new WorkspaceReservationDeliveryGenerationSupersededError(
              {
                operation:
                  "workspaceReservations.markAwaitingCustomerEmailDelivery",
                reservationId: input.id,
                expectedActiveCustomerEmailDeliveryId:
                  input.expectedActiveCustomerEmailDeliveryId,
                activeCustomerEmailDeliveryId:
                  current.activeCustomerEmailDeliveryId,
              }
            );
          }
          yield* ensureUpdated(
            updated,
            "workspaceReservations.markAwaitingCustomerEmailDelivery",
            input.id,
            "Only processing paid reservations can await customer email delivery."
          );
        }),
        markCustomerEmailDeliveryFulfilled: Effect.fn(
          "workspaceReservations.markCustomerEmailDeliveryFulfilled"
        )(function* (input) {
          const fulfillmentStillApplies = or(
            eq(workspaceReservations.fulfillmentState, "awaiting_delivery"),
            and(
              eq(workspaceReservations.fulfillmentState, "failed"),
              eq(
                workspaceReservations.fulfillmentFailureCode,
                fulfillmentEmailFailureCode
              ),
              sql`${workspaceReservations.fulfillmentFailedAt} is not null`,
              lt(workspaceReservations.fulfillmentFailedAt, input.fulfilledAt)
            )
          );
          const [updated] = yield* db
            .update(workspaceReservations)
            .set({
              fulfillmentState: "fulfilled",
              fulfilledAt: input.fulfilledAt,
              // A recovery keeps the failure's time, so a status replay
              // knows the reservation failed before it recovered.
              fulfillmentFailureCode: null,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(
                  workspaceReservations.activeCustomerEmailDeliveryId,
                  input.customerEmailDeliveryId
                ),
                eq(workspaceReservations.paymentState, "paid"),
                fulfillmentStillApplies
              )
            )
            .returning();
          return yield* decodeOptionalWorkspaceReservation(updated);
        }),
        markCustomerEmailDeliveryFailed: Effect.fn(
          "workspaceReservations.markCustomerEmailDeliveryFailed"
        )(function* (input) {
          const failureStillApplies = or(
            eq(workspaceReservations.fulfillmentState, "awaiting_delivery"),
            and(
              eq(workspaceReservations.fulfillmentState, "fulfilled"),
              sql`${workspaceReservations.fulfilledAt} is not null`,
              lt(workspaceReservations.fulfilledAt, input.failedAt)
            ),
            and(
              eq(workspaceReservations.fulfillmentState, "failed"),
              eq(
                workspaceReservations.fulfillmentFailureCode,
                input.failureCode
              ),
              sql`${workspaceReservations.fulfillmentFailedAt} is not null`,
              lt(workspaceReservations.fulfillmentFailedAt, input.failedAt)
            )
          );
          const [updated] = yield* db
            .update(workspaceReservations)
            .set({
              fulfillmentState: "failed",
              fulfilledAt: null,
              fulfillmentFailedAt: input.failedAt,
              fulfillmentFailureCode: input.failureCode,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(
                  workspaceReservations.activeCustomerEmailDeliveryId,
                  input.customerEmailDeliveryId
                ),
                eq(workspaceReservations.paymentState, "paid"),
                failureStillApplies
              )
            )
            .returning();
          return yield* decodeOptionalWorkspaceReservation(updated);
        }),
        markFulfilled: Effect.fn("workspaceReservations.markFulfilled")(
          function* (input) {
            const updated = yield* db
              .update(workspaceReservations)
              .set({
                fulfillmentState: "fulfilled",
                fulfilledAt: input.fulfilledAt,
                activeCustomerEmailDeliveryId: input.customerEmailDeliveryId,
                // Recording the accepted send closes its idempotency generation,
                // so a later recovery resolves the current preference again.
                activeCustomerEmailDeliveryLocale: null,
                updatedAt: Temporal.Now.instant(),
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.paymentState, "paid"),
                  eq(workspaceReservations.fulfillmentState, "processing")
                )
              )
              .returning({ id: workspaceReservations.id });
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
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              fulfillmentState: "failed",
              fulfillmentFailedAt: input.failedAt,
              fulfillmentFailureCode: input.failureCode,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.paymentState, "paid"),
                eq(workspaceReservations.fulfillmentState, "processing")
              )
            )
            .returning({ id: workspaceReservations.id });
          yield* ensureUpdated(
            updated,
            "workspaceReservations.markFulfillmentFailed",
            input.id,
            "Only processing paid reservations can be marked fulfillment failed."
          );
        }),
        selectStalledPaidFulfillments: Effect.fn(
          "workspaceReservations.selectStalledPaidFulfillments"
        )(
          function* (input) {
            const rows = yield* db
              .select({ id: workspaceReservations.id })
              .from(workspaceReservations)
              .where(
                and(
                  eq(workspaceReservations.paymentState, "paid"),
                  inArray(workspaceReservations.reservationState, [
                    "held",
                    "confirmed",
                  ]),
                  inArray(workspaceReservations.fulfillmentState, [
                    "not_started",
                    "processing",
                  ]),
                  lte(workspaceReservations.updatedAt, input.updatedBefore),
                  isOutsideLatePaymentRecovery()
                )
              )
              .orderBy(
                asc(workspaceReservations.updatedAt),
                asc(workspaceReservations.id)
              )
              .limit(input.limit)
              .pipe(retryDatabaseRead);
            return rows.map(({ id }) => id as WorkspaceReservationId);
          },
          (effect, input) => effect.pipe(Effect.annotateLogs(input))
        ),
      } satisfies IFulfillmentLedger;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
