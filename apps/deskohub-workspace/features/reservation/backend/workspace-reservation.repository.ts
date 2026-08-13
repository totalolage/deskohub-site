import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  paymentAttempts,
  reservationAccessGrants,
  type WorkspaceReservation as WorkspaceReservationRow,
  workspaceReservations,
} from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";
import type {
  CheckoutAttemptKey,
  CheckoutSessionKey,
} from "@/features/checkout/checkout-identifiers";
import { withCoworkProductFields } from "@/features/reservation/cowork-reservation-product";
import {
  type StoredWorkspaceReservationDetails,
  storedWorkspaceReservationDetailsSchema,
  type WorkspaceReservationId,
} from "@/features/reservation/persistence-contracts";
import type { ReservationPurpose } from "@/features/reservation/reservation-billing";
import { reservationAccessProvisioningStaleAfterMilliseconds } from "@/features/reservation-access";
import { supersedableReservationPaymentStates } from "./reservation-supersession";

const withReservationKindFields = (reservation: WorkspaceReservationRow) => {
  const reservationWithCoworkFields = withCoworkProductFields(reservation);

  // Compose field enrichments for additional reservation kinds here.
  return reservationWithCoworkFields;
};

export type WorkspaceReservation = ReturnType<typeof withReservationKindFields>;

export class WorkspaceReservationStateError extends Data.TaggedError(
  "WorkspaceReservationStateError"
)<{
  readonly operation: string;
  readonly reservationId: WorkspaceReservationId;
  readonly message: string;
}> {}

export class WorkspaceReservationDetailsMalformedError extends Data.TaggedError(
  "WorkspaceReservationDetailsMalformedError"
)<{
  readonly reservationId: WorkspaceReservationId;
  readonly message: string;
  readonly cause: unknown;
}> {}

export interface CreateWorkspaceReservationInput {
  readonly checkoutSessionKey: CheckoutSessionKey;
  readonly checkoutAttemptKey: CheckoutAttemptKey;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly reservationPurpose: ReservationPurpose;
  readonly reservationDetails: StoredWorkspaceReservationDetails;
  readonly locale: string;
  readonly reservationHoldExpiresAt?: Temporal.Instant;
}

export interface WorkspaceReservationRepository {
  readonly createDraft: (
    input: CreateWorkspaceReservationInput
  ) => Effect.Effect<
    WorkspaceReservation,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly findById: (
    id: WorkspaceReservationId
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly findByAttemptKey: (
    checkoutAttemptKey: CheckoutAttemptKey
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly findCurrentByCheckoutSessionKey: (
    checkoutSessionKey: CheckoutSessionKey
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly updateReservationDetails: (input: {
    readonly id: WorkspaceReservationId;
    readonly reservationDetails: StoredWorkspaceReservationDetails;
    readonly locale: string;
  }) => Effect.Effect<
    WorkspaceReservation,
    | EffectDrizzleQueryError
    | WorkspaceReservationDetailsMalformedError
    | WorkspaceReservationStateError
  >;
  readonly claimHoldCreation: (
    id: WorkspaceReservationId
  ) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  readonly releaseHoldCreation: (
    id: WorkspaceReservationId
  ) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly attachHold: (input: {
    readonly id: WorkspaceReservationId;
    readonly dotyposReservationId: DotyposReservationId;
    readonly reservationCreatedAt: Temporal.Instant;
    readonly reservationHoldExpiresAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly markAttachFailedCancellationRequired: (input: {
    readonly id: WorkspaceReservationId;
    readonly dotyposReservationId: DotyposReservationId;
    readonly reservationCreatedAt: Temporal.Instant;
    readonly failureCode: string;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly claimCancellation: (
    id: WorkspaceReservationId
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly claimSupersessionCancellation: (
    id: WorkspaceReservationId
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly claimAdministrationCancellation: (input: {
    readonly accessGrantUpdatedAt: string | null;
    readonly id: WorkspaceReservationId;
    readonly providerCredentialRemoved: boolean;
    readonly staleCancellingBefore: Temporal.Instant;
  }) => Effect.Effect<
    WorkspaceReservation | null,
    | EffectDrizzleQueryError
    | SqlError.SqlError
    | WorkspaceReservationDetailsMalformedError
  >;
  readonly markCancelled: (input: {
    readonly id: WorkspaceReservationId;
    readonly cancelledAt: Temporal.Instant;
    readonly holdExpiredAt?: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly markAdministrationCancelled: (input: {
    readonly id: WorkspaceReservationId;
    readonly cancelledAt: Temporal.Instant;
    readonly claimedAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | SqlError.SqlError | WorkspaceReservationStateError
  >;
  readonly completeSupersessionAndCreateDraft: (input: {
    readonly cancelledReservationId: WorkspaceReservationId;
    readonly cancelledAt: Temporal.Instant;
    readonly replacement: CreateWorkspaceReservationInput;
  }) => Effect.Effect<
    WorkspaceReservation,
    | EffectDrizzleQueryError
    | SqlError.SqlError
    | WorkspaceReservationDetailsMalformedError
    | WorkspaceReservationStateError
  >;
  readonly markCancellationFailed: (input: {
    readonly id: WorkspaceReservationId;
    readonly failureCode: string;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly markAdministrationCancellationFailed: (input: {
    readonly id: WorkspaceReservationId;
    readonly claimedAt: Temporal.Instant;
    readonly failureCode: string;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly recordHoldCleanupSkipped: (input: {
    readonly id: WorkspaceReservationId;
    readonly holdExpiredAt: Temporal.Instant;
    readonly failureCode: string;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly claimPaidFulfillment: (input: {
    readonly id: WorkspaceReservationId;
    readonly staleProcessingBefore: Temporal.Instant;
  }) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly markFulfilled: (input: {
    readonly id: WorkspaceReservationId;
    readonly fulfilledAt: Temporal.Instant;
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
  readonly markFulfillmentDeliveryFailed: (input: {
    readonly id: WorkspaceReservationId;
    readonly failureCode: string;
    readonly failedAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly markReservationConfirmed: (input: {
    readonly id: WorkspaceReservationId;
    readonly confirmedAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | WorkspaceReservationStateError
  >;
  readonly selectExpiredHolds: (input: {
    readonly now: Temporal.Instant;
    readonly limit: number;
  }) => Effect.Effect<
    readonly WorkspaceReservation[],
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  readonly selectExpiredHoldDotyposReservationIds: (input: {
    readonly now: Temporal.Instant;
  }) => Effect.Effect<readonly DotyposReservationId[], EffectDrizzleQueryError>;
}

export const WorkspaceReservationRepository =
  Context.Service<WorkspaceReservationRepository>(
    "WorkspaceReservationRepository"
  );

const ensureUpdated = (
  updated: readonly Pick<WorkspaceReservation, "id">[],
  operation: string,
  reservationId: WorkspaceReservationId,
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
      function* (id: WorkspaceReservationId) {
        const [reservation] = yield* db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, id))
          .limit(1);
        return yield* decodeOptionalWorkspaceReservation(reservation);
      },
      (effect, reservationId) =>
        effect.pipe(Effect.annotateLogs({ reservationId }))
    );

    return WorkspaceReservationRepository.of({
      createDraft: Effect.fn("workspaceReservations.createDraft")(
        function* (input) {
          const row = {
            id: postgresUuidV7,
            checkoutSessionKey: input.checkoutSessionKey,
            checkoutAttemptKey: input.checkoutAttemptKey,
            correlationId: postgresUuidV7,
            dotyposCustomerId: input.dotyposCustomerId,
            reservationPurpose: input.reservationPurpose,
            reservationState: "draft" as const,
            paymentState: "not_started" as const,
            fulfillmentState: "not_started" as const,
            reservationDetails: input.reservationDetails,
            locale: input.locale,
            reservationHoldExpiresAt: input.reservationHoldExpiresAt,
          };

          const [inserted] = yield* db
            .insert(workspaceReservations)
            .values(row)
            .onConflictDoNothing()
            .returning();

          if (inserted) return yield* decodeWorkspaceReservation(inserted);

          const [existingAttempt] = yield* db
            .select()
            .from(workspaceReservations)
            .where(
              eq(
                workspaceReservations.checkoutAttemptKey,
                input.checkoutAttemptKey
              )
            )
            .limit(1);

          if (existingAttempt) {
            return yield* decodeWorkspaceReservation(existingAttempt);
          }

          const [currentAttempt] = yield* db
            .select()
            .from(workspaceReservations)
            .where(
              and(
                eq(
                  workspaceReservations.checkoutSessionKey,
                  input.checkoutSessionKey
                ),
                sql`${workspaceReservations.reservationState} <> 'cancelled'`
              )
            )
            .orderBy(desc(workspaceReservations.createdAt))
            .limit(1);

          if (!currentAttempt) {
            return yield* Effect.die(
              "Workspace reservation insert returned no row."
            );
          }
          return yield* decodeWorkspaceReservation(currentAttempt);
        },
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({
              checkoutSessionKey: input.checkoutSessionKey,
              checkoutAttemptKey: input.checkoutAttemptKey,
              dotyposCustomerId: input.dotyposCustomerId,
            })
          )
      ),
      findById,
      findByAttemptKey: Effect.fn("workspaceReservations.findByAttemptKey")(
        function* (checkoutAttemptKey) {
          const [reservation] = yield* db
            .select()
            .from(workspaceReservations)
            .where(
              eq(workspaceReservations.checkoutAttemptKey, checkoutAttemptKey)
            )
            .limit(1);
          return yield* decodeOptionalWorkspaceReservation(reservation);
        },
        (effect, checkoutAttemptKey) =>
          effect.pipe(Effect.annotateLogs({ checkoutAttemptKey }))
      ),
      findCurrentByCheckoutSessionKey: Effect.fn(
        "workspaceReservations.findCurrentByCheckoutSessionKey"
      )(
        function* (checkoutSessionKey) {
          const [reservation] = yield* db
            .select()
            .from(workspaceReservations)
            .where(
              and(
                eq(
                  workspaceReservations.checkoutSessionKey,
                  checkoutSessionKey
                ),
                sql`${workspaceReservations.reservationState} <> 'cancelled'`
              )
            )
            .orderBy(desc(workspaceReservations.createdAt))
            .limit(1);
          return yield* decodeOptionalWorkspaceReservation(reservation);
        },
        (effect, checkoutSessionKey) =>
          effect.pipe(Effect.annotateLogs({ checkoutSessionKey }))
      ),
      updateReservationDetails: Effect.fn(
        "workspaceReservations.updateReservationDetails"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            reservationDetails: input.reservationDetails,
            locale: input.locale,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              inArray(workspaceReservations.reservationState, ["draft", "held"])
            )
          )
          .returning();
        if (!updated[0]) {
          return yield* new WorkspaceReservationStateError({
            operation: "workspaceReservations.updateReservationDetails",
            reservationId: input.id,
            message:
              "Only draft or held reservations can refresh reservation details.",
          });
        }
        return yield* decodeWorkspaceReservation(updated[0]);
      }),
      claimHoldCreation: Effect.fn("workspaceReservations.claimHoldCreation")(
        function* (id) {
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              reservationState: "creating_hold",
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, id),
                eq(workspaceReservations.reservationState, "draft")
              )
            )
            .returning({ id: workspaceReservations.id });
          return updated.length > 0;
        },
        (effect, reservationId) =>
          effect.pipe(Effect.annotateLogs({ reservationId }))
      ),
      releaseHoldCreation: Effect.fn(
        "workspaceReservations.releaseHoldCreation"
      )(function* (id) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            reservationState: "draft",
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, id),
              eq(workspaceReservations.reservationState, "creating_hold"),
              sql`${workspaceReservations.dotyposReservationId} is null`
            )
          )
          .returning({ id: workspaceReservations.id });
        yield* ensureUpdated(
          updated,
          "workspaceReservations.releaseHoldCreation",
          id,
          "Only unattached creating_hold reservations can be released."
        );
      }),
      attachHold: Effect.fn("workspaceReservations.attachHold")(
        function* (input) {
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              dotyposReservationId: input.dotyposReservationId,
              reservationState: "held",
              reservationCreatedAt: input.reservationCreatedAt,
              reservationHoldExpiresAt: input.reservationHoldExpiresAt,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.reservationState, "creating_hold")
              )
            )
            .returning({ id: workspaceReservations.id });
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
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            dotyposReservationId: input.dotyposReservationId,
            reservationCreatedAt: input.reservationCreatedAt,
            reservationState: "cancellation_failed",
            failureCode: input.failureCode,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "creating_hold")
            )
          )
          .returning({ id: workspaceReservations.id });
        yield* ensureUpdated(
          updated,
          "workspaceReservations.markAttachFailedCancellationRequired",
          input.id,
          "Only creating_hold reservations can record attach-cancel recovery."
        );
      }),
      claimCancellation: Effect.fn("workspaceReservations.claimCancellation")(
        function* (id) {
          const [claimed] = yield* db
            .update(workspaceReservations)
            .set({
              reservationState: "cancelling",
              updatedAt: Temporal.Now.instant(),
            })
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
          return yield* decodeOptionalWorkspaceReservation(claimed);
        }
      ),
      claimSupersessionCancellation: Effect.fn(
        "workspaceReservations.claimSupersessionCancellation"
      )(function* (id) {
        const [claimed] = yield* db
          .update(workspaceReservations)
          .set({
            reservationState: "cancelling",
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, id),
              eq(workspaceReservations.reservationState, "held"),
              inArray(
                workspaceReservations.paymentState,
                supersedableReservationPaymentStates
              )
            )
          )
          .returning();
        return yield* decodeOptionalWorkspaceReservation(claimed);
      }),
      claimAdministrationCancellation: Effect.fn(
        "workspaceReservations.claimAdministrationCancellation"
      )(function* (input) {
        const transaction = db.transaction((tx) =>
          Effect.gen(function* () {
            const now = Temporal.Now.instant();
            const [grant] = yield* tx
              .select({
                id: reservationAccessGrants.id,
                state: reservationAccessGrants.state,
                accessEndsAt: reservationAccessGrants.accessEndsAt,
                provisioningStartedAt:
                  reservationAccessGrants.provisioningStartedAt,
                updatedAt: reservationAccessGrants.updatedAt,
              })
              .from(reservationAccessGrants)
              .where(
                eq(reservationAccessGrants.workspaceReservationId, input.id)
              )
              .limit(1)
              .for("update");
            const credentialMayBeLive =
              grant !== undefined &&
              ["issued", "uncertain", "provisioning"].includes(grant.state) &&
              Temporal.Instant.compare(grant.accessEndsAt, now) > 0;
            const provisioningIsLive =
              grant?.state === "provisioning" &&
              grant.provisioningStartedAt !== null &&
              Temporal.Instant.compare(
                grant.provisioningStartedAt,
                now.subtract({
                  milliseconds:
                    reservationAccessProvisioningStaleAfterMilliseconds,
                })
              ) > 0;
            if (
              credentialMayBeLive &&
              (!input.providerCredentialRemoved ||
                input.accessGrantUpdatedAt !== grant.updatedAt.toString() ||
                provisioningIsLive)
            ) {
              return null;
            }

            const [claimed] = yield* tx
              .update(workspaceReservations)
              .set({
                reservationState: "cancelling",
                updatedAt: now,
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  or(
                    inArray(workspaceReservations.reservationState, [
                      "held",
                      "hold_expired",
                      "confirmed",
                      "cancellation_failed",
                    ]),
                    and(
                      eq(workspaceReservations.reservationState, "cancelling"),
                      lte(
                        workspaceReservations.updatedAt,
                        input.staleCancellingBefore
                      )
                    )
                  ),
                  sql`${workspaceReservations.paymentState} <> 'pending'`,
                  sql`${workspaceReservations.fulfillmentState} <> 'processing'`
                )
              )
              .returning();
            if (!claimed) return null;

            if (
              grant &&
              ["issued", "uncertain", "provisioning"].includes(grant.state)
            ) {
              yield* tx
                .update(reservationAccessGrants)
                .set({
                  state: "expired",
                  accessCode: null,
                  updatedAt: now,
                })
                .where(eq(reservationAccessGrants.id, grant.id));
            }
            return yield* decodeWorkspaceReservation(claimed);
          })
        );
        return yield* transaction;
      }),
      markCancelled: Effect.fn("workspaceReservations.markCancelled")(
        function* (input) {
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              reservationState: "cancelled",
              reservationCancelledAt: input.cancelledAt,
              reservationHoldExpiredAt: input.holdExpiredAt,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, input.id),
                eq(workspaceReservations.reservationState, "cancelling"),
                sql`${workspaceReservations.paymentState} <> 'paid'`,
                sql`${workspaceReservations.reservationConfirmedAt} is null`
              )
            )
            .returning({ id: workspaceReservations.id });
          yield* ensureUpdated(
            updated,
            "workspaceReservations.markCancelled",
            input.id,
            "Only unpaid cancelling reservations can be marked cancelled."
          );
        }
      ),
      markAdministrationCancelled: Effect.fn(
        "workspaceReservations.markAdministrationCancelled"
      )(function* (input) {
        const transaction = db.transaction((tx) =>
          Effect.gen(function* () {
            const updatedAt = Temporal.Now.instant();
            const updated = yield* tx
              .update(workspaceReservations)
              .set({
                reservationState: "cancelled",
                reservationCancelledAt: input.cancelledAt,
                failureCode: null,
                updatedAt,
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.id),
                  eq(workspaceReservations.reservationState, "cancelling"),
                  eq(workspaceReservations.updatedAt, input.claimedAt)
                )
              )
              .returning({ id: workspaceReservations.id });
            yield* ensureUpdated(
              updated,
              "workspaceReservations.markAdministrationCancelled",
              input.id,
              "Only an operator-cancelled reservation can be marked cancelled."
            );
            yield* tx
              .update(paymentAttempts)
              .set({ refundState: "required", updatedAt })
              .where(
                and(
                  eq(paymentAttempts.workspaceReservationId, input.id),
                  eq(paymentAttempts.provider, "nexi"),
                  eq(paymentAttempts.state, "paid")
                )
              );
          })
        );
        yield* transaction;
      }),
      completeSupersessionAndCreateDraft: Effect.fn(
        "workspaceReservations.completeSupersessionAndCreateDraft"
      )(function* (input) {
        const transaction = db.transaction((tx) =>
          Effect.gen(function* () {
            const [cancelled] = yield* tx
              .update(workspaceReservations)
              .set({
                reservationState: "cancelled",
                reservationCancelledAt: input.cancelledAt,
                updatedAt: input.cancelledAt,
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.cancelledReservationId),
                  eq(workspaceReservations.reservationState, "cancelling"),
                  sql`${workspaceReservations.paymentState} <> 'pending'`,
                  sql`${workspaceReservations.paymentState} <> 'paid'`,
                  sql`${workspaceReservations.reservationConfirmedAt} is null`
                )
              )
              .returning({ id: workspaceReservations.id });

            if (!cancelled) {
              return yield* new WorkspaceReservationStateError({
                operation:
                  "workspaceReservations.completeSupersessionAndCreateDraft",
                reservationId: input.cancelledReservationId,
                message:
                  "Only an unpaid supersession cancellation can create its replacement.",
              });
            }

            const [replacement] = yield* tx
              .insert(workspaceReservations)
              .values({
                id: postgresUuidV7,
                checkoutSessionKey: input.replacement.checkoutSessionKey,
                checkoutAttemptKey: input.replacement.checkoutAttemptKey,
                correlationId: postgresUuidV7,
                dotyposCustomerId: input.replacement.dotyposCustomerId,
                reservationPurpose: input.replacement.reservationPurpose,
                reservationState: "draft",
                paymentState: "not_started",
                fulfillmentState: "not_started",
                reservationDetails: input.replacement.reservationDetails,
                locale: input.replacement.locale,
                reservationHoldExpiresAt:
                  input.replacement.reservationHoldExpiresAt,
              })
              .returning();

            if (!replacement) {
              return yield* Effect.die(
                "Workspace replacement reservation insert returned no row."
              );
            }

            return replacement;
          })
        );

        return yield* transaction.pipe(
          Effect.flatMap(decodeWorkspaceReservation)
        );
      }),
      markCancellationFailed: Effect.fn(
        "workspaceReservations.markCancellationFailed"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            reservationState: "cancellation_failed",
            failureCode: input.failureCode,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "cancelling"),
              sql`${workspaceReservations.paymentState} <> 'paid'`
            )
          )
          .returning({ id: workspaceReservations.id });
        yield* ensureUpdated(
          updated,
          "workspaceReservations.markCancellationFailed",
          input.id,
          "Workspace reservation was not found."
        );
      }),
      markAdministrationCancellationFailed: Effect.fn(
        "workspaceReservations.markAdministrationCancellationFailed"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            reservationState: "cancellation_failed",
            failureCode: input.failureCode,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "cancelling"),
              eq(workspaceReservations.updatedAt, input.claimedAt)
            )
          )
          .returning({ id: workspaceReservations.id });
        yield* ensureUpdated(
          updated,
          "workspaceReservations.markAdministrationCancellationFailed",
          input.id,
          "Workspace reservation was not being cancelled."
        );
      }),
      recordHoldCleanupSkipped: Effect.fn(
        "workspaceReservations.recordHoldCleanupSkipped"
      )(function* (input) {
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            reservationHoldExpiredAt: input.holdExpiredAt,
            failureCode: input.failureCode,
            updatedAt: Temporal.Now.instant(),
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
          .returning({ id: workspaceReservations.id });
        yield* ensureUpdated(
          updated,
          "workspaceReservations.recordHoldCleanupSkipped",
          input.id,
          "Only unpaid expired held reservations can record skipped cleanup."
        );
      }),
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
      markFulfilled: Effect.fn("workspaceReservations.markFulfilled")(
        function* (input) {
          const updated = yield* db
            .update(workspaceReservations)
            .set({
              fulfillmentState: "fulfilled",
              fulfilledAt: input.fulfilledAt,
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
      markFulfillmentDeliveryFailed: Effect.fn(
        "workspaceReservations.markFulfillmentDeliveryFailed"
      )(function* (input) {
        const updated = yield* db
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
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.paymentState, "paid"),
              inArray(workspaceReservations.fulfillmentState, [
                "processing",
                "fulfilled",
              ])
            )
          )
          .returning({ id: workspaceReservations.id });
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
        const updated = yield* db
          .update(workspaceReservations)
          .set({
            reservationState: "confirmed",
            reservationConfirmedAt: input.confirmedAt,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(workspaceReservations.id, input.id),
              eq(workspaceReservations.reservationState, "held"),
              eq(workspaceReservations.paymentState, "paid"),
              eq(workspaceReservations.fulfillmentState, "processing")
            )
          )
          .returning({ id: workspaceReservations.id });
        yield* ensureUpdated(
          updated,
          "workspaceReservations.markReservationConfirmed",
          input.id,
          "Only processing paid held reservations can be marked confirmed."
        );
      }),
      selectExpiredHolds: Effect.fn("workspaceReservations.selectExpiredHolds")(
        function* (input) {
          const reservations = yield* db
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
            .limit(input.limit);
          return yield* Effect.forEach(
            reservations,
            decodeWorkspaceReservation,
            { concurrency: "inherit" }
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),
      selectExpiredHoldDotyposReservationIds: Effect.fn(
        "workspaceReservations.selectExpiredHoldDotyposReservationIds"
      )(function* (input) {
        const rows = yield* db
          .select({
            dotyposReservationId: workspaceReservations.dotyposReservationId,
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
          );

        return rows.flatMap(({ dotyposReservationId }) =>
          dotyposReservationId ? [dotyposReservationId] : []
        );
      }),
    });
  })
);

const decodeOptionalWorkspaceReservation = (
  reservation: WorkspaceReservationRow | undefined
) =>
  reservation ? decodeWorkspaceReservation(reservation) : Effect.succeed(null);

const decodeWorkspaceReservation = Effect.fn(
  "WorkspaceReservation.decodeStoredDetails"
)((reservation: WorkspaceReservationRow) =>
  Schema.decodeUnknownEffect(storedReservationDetailsDecoder, {
    errors: "all",
    onExcessProperty: "error",
  })(reservation.reservationDetails).pipe(
    Effect.map((reservationDetails) =>
      withReservationKindFields({
        ...reservation,
        reservationDetails,
      })
    ),
    Effect.mapError(
      (cause) =>
        new WorkspaceReservationDetailsMalformedError({
          reservationId: reservation.id,
          message: "Stored workspace reservation details are malformed.",
          cause,
        })
    )
  )
);

const storedReservationDetailsDecoder: Schema.Decoder<
  WorkspaceReservationRow["reservationDetails"]
> = storedWorkspaceReservationDetailsSchema;
