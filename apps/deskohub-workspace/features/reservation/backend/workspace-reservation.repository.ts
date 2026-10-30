import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import { retryDatabaseRead } from "@/db/retry-database-read";
import {
  paymentAttempts,
  reservationAccessGrants,
  type WorkspaceReservationRow,
  workspaceReservations,
} from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";
import { WorkspaceLocks } from "@/db/workspace-locks";
import type { CustomerAgentClientId } from "@/features/account";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { releaseCodeClaim } from "@/features/checkout/backend/repositories/payment-lifecycle.repository";
import type {
  CheckoutAttemptKey,
  CheckoutSessionKey,
  PaymentAttemptId,
} from "@/features/checkout/checkout-identifiers";
import type { DiscountClaimError } from "@/features/discounts/errors";
import type { AgentSelectionKey } from "@/features/reservation/backend/booking-agent";
import { withCoworkProductFields } from "@/features/reservation/cowork-reservation-product";
import type {
  StoredWorkspaceReservationDetails,
  WorkspaceReservationId,
} from "@/features/reservation/persistence-contracts";
import type { ReservationPurpose } from "@/features/reservation/reservation-billing";
import { reservationAccessProvisioningStaleAfterMilliseconds } from "@/features/reservation-access";
import { recordCustomerEvent } from "@/shared/backend/customer-events/customer-event-outbox";
import { supersedableReservationPaymentStates } from "./reservation-supersession";
import {
  StoredReservationDetails,
  type WorkspaceReservationDetailsMalformedError,
} from "./stored-reservation-details.server";

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

export interface CreateWorkspaceReservationInput {
  readonly checkoutSessionKey: CheckoutSessionKey;
  readonly checkoutAttemptKey: CheckoutAttemptKey;
  readonly dotyposCustomerId: DotyposCustomerId;
  /** The signed-in account making the reservation. */
  readonly authorAccountId: CustomerAccountId;
  /** The customer's AI agent that started the reservation, if one did. */
  readonly agentClientId?: CustomerAgentClientId;
  /** The agent booking request the reservation answers, if an agent made it. */
  readonly agentSelectionKey?: AgentSelectionKey;
  readonly reservationPurpose: ReservationPurpose;
  readonly reservationDetails: StoredWorkspaceReservationDetails;
  readonly locale: string;
  readonly reservationHoldExpiresAt?: Temporal.Instant;
}

/**
 * Creates the first draft of a checkout attempt. `checkoutSessionKey` and
 * `checkoutAttemptKey` are the derivations new rows store, used only when the
 * session and attempt have no row under any accepted derivation.
 */
export interface CreateWorkspaceReservationDraftInput
  extends CreateWorkspaceReservationInput {
  /** Rotation-independent lock identity of the raw checkout session. */
  readonly checkoutSessionLockKey: bigint;
  readonly acceptedCheckoutSessionKeys: readonly CheckoutSessionKey[];
  readonly acceptedCheckoutAttemptKeys: readonly CheckoutAttemptKey[];
}

export interface IWorkspaceReservationRepository {
  /**
   * Serializes draft creation per checkout session so workers with different
   * active Pay-state keys or stored lookup-key formats cannot both create a
   * first row. Returns the attempt's existing row, else the session's current
   * row, else the draft inserted under the session's already stored key.
   */
  readonly createDraft: (
    input: CreateWorkspaceReservationDraftInput
  ) => Effect.Effect<
    WorkspaceReservation,
    | EffectDrizzleQueryError
    | SqlError.SqlError
    | WorkspaceReservationDetailsMalformedError
  >;
  readonly findById: (
    id: WorkspaceReservationId
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  /** Finds the reservation stored under any accepted derivation of one attempt. */
  readonly findByAttemptKeys: (
    checkoutAttemptKeys: readonly CheckoutAttemptKey[]
  ) => Effect.Effect<
    WorkspaceReservation | null,
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  /**
   * Returns the session key stored by the latest reservation under any
   * accepted derivation of one checkout session, so every reservation in the
   * session keeps grouping under one key across key rotation.
   */
  readonly findStoredCheckoutSessionKey: (
    checkoutSessionKeys: readonly CheckoutSessionKey[]
  ) => Effect.Effect<CheckoutSessionKey | null, EffectDrizzleQueryError>;
  /**
   * The latest two reservations the account's agent booking request created,
   * newest first: the request's current reservation and the one before it.
   */
  readonly findLatestByAgentSelectionKey: (input: {
    readonly authorAccountId: CustomerAccountId;
    readonly agentSelectionKey: AgentSelectionKey;
  }) => Effect.Effect<
    readonly WorkspaceReservation[],
    EffectDrizzleQueryError | WorkspaceReservationDetailsMalformedError
  >;
  /**
   * The account's holds through one agent client that a new booking may
   * still supersede: held, with no payment pending or completed.
   */
  readonly findSupersedableByAgentClient: (input: {
    readonly authorAccountId: CustomerAccountId;
    readonly agentClientId: CustomerAgentClientId;
  }) => Effect.Effect<
    readonly WorkspaceReservation[],
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
    readonly pendingPaymentCancellation?: {
      readonly paymentAttemptId: PaymentAttemptId;
      readonly failureCode: string;
    };
    readonly providerCredentialRemoved: boolean;
    readonly staleCancellingBefore: Temporal.Instant;
  }) => Effect.Effect<
    WorkspaceReservation | null,
    | DiscountClaimError
    | EffectDrizzleQueryError
    | SqlError.SqlError
    | WorkspaceReservationDetailsMalformedError
    | WorkspaceReservationStateError
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
    readonly failureCode: string | null;
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
  /** Records the booked customer event in the confirmation's transaction. */
  readonly markReservationConfirmed: (input: {
    readonly id: WorkspaceReservationId;
    readonly confirmedAt: Temporal.Instant;
  }) => Effect.Effect<
    void,
    EffectDrizzleQueryError | SqlError.SqlError | WorkspaceReservationStateError
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

export const ensureUpdated = (
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

export class WorkspaceReservationRepository extends Context.Service<
  WorkspaceReservationRepository,
  IWorkspaceReservationRepository
>()("WorkspaceReservationRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;

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

      return {
        createDraft: Effect.fn("workspaceReservations.createDraft")(
          function* (input) {
            return yield* transaction(
              Effect.gen(function* () {
                yield* WorkspaceLocks.checkoutSession(
                  input.checkoutSessionLockKey
                );

                const findAttemptRow = () =>
                  db
                    .select()
                    .from(workspaceReservations)
                    .where(
                      inArray(
                        workspaceReservations.checkoutAttemptKey,
                        input.acceptedCheckoutAttemptKeys
                      )
                    )
                    .orderBy(desc(workspaceReservations.createdAt))
                    .limit(1);

                const [existingAttempt] = yield* findAttemptRow();
                if (existingAttempt) {
                  return yield* decodeWorkspaceReservation(existingAttempt);
                }

                const [storedSession] = yield* db
                  .select({
                    checkoutSessionKey:
                      workspaceReservations.checkoutSessionKey,
                  })
                  .from(workspaceReservations)
                  .where(
                    inArray(
                      workspaceReservations.checkoutSessionKey,
                      input.acceptedCheckoutSessionKeys
                    )
                  )
                  .orderBy(desc(workspaceReservations.createdAt))
                  .limit(1);
                const checkoutSessionKey =
                  storedSession?.checkoutSessionKey ?? input.checkoutSessionKey;
                const findCurrentSessionRow = () =>
                  db
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

                const [currentSessionRow] = yield* findCurrentSessionRow();
                if (currentSessionRow) {
                  return yield* decodeWorkspaceReservation(currentSessionRow);
                }

                const [inserted] = yield* db
                  .insert(workspaceReservations)
                  .values({
                    id: postgresUuidV7,
                    checkoutSessionKey,
                    checkoutAttemptKey: input.checkoutAttemptKey,
                    correlationId: postgresUuidV7,
                    dotyposCustomerId: input.dotyposCustomerId,
                    authorAccountId: input.authorAccountId,
                    agentClientId: input.agentClientId ?? null,
                    agentSelectionKey: input.agentSelectionKey ?? null,
                    reservationPurpose: input.reservationPurpose,
                    reservationState: "draft",
                    paymentState: "not_started",
                    fulfillmentState: "not_started",
                    reservationDetails: input.reservationDetails,
                    locale: input.locale,
                    reservationHoldExpiresAt: input.reservationHoldExpiresAt,
                  })
                  .onConflictDoNothing()
                  .returning();
                if (inserted) {
                  return yield* decodeWorkspaceReservation(inserted);
                }

                // Writers that skip this lock can still win a unique index
                // here: a worker from before the lock may have stored this
                // attempt, even if it is already cancelled, and supersession
                // inserts its replacement as the session's current row.
                const [conflictingAttempt] = yield* findAttemptRow();
                if (conflictingAttempt) {
                  return yield* decodeWorkspaceReservation(conflictingAttempt);
                }
                const [replacement] = yield* findCurrentSessionRow();
                if (!replacement) {
                  return yield* Effect.die(
                    "Workspace reservation insert returned no row."
                  );
                }
                return yield* decodeWorkspaceReservation(replacement);
              })
            );
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
        findByAttemptKeys: Effect.fn("workspaceReservations.findByAttemptKeys")(
          function* (checkoutAttemptKeys) {
            const [reservation] = yield* db
              .select()
              .from(workspaceReservations)
              .where(
                inArray(
                  workspaceReservations.checkoutAttemptKey,
                  checkoutAttemptKeys
                )
              )
              .orderBy(desc(workspaceReservations.createdAt))
              .limit(1);
            return yield* decodeOptionalWorkspaceReservation(reservation);
          },
          (effect, checkoutAttemptKeys) =>
            effect.pipe(
              Effect.annotateLogs({
                checkoutAttemptKey: checkoutAttemptKeys[0],
              })
            )
        ),
        findStoredCheckoutSessionKey: Effect.fn(
          "workspaceReservations.findStoredCheckoutSessionKey"
        )(
          function* (checkoutSessionKeys) {
            const [reservation] = yield* db
              .select({
                checkoutSessionKey: workspaceReservations.checkoutSessionKey,
              })
              .from(workspaceReservations)
              .where(
                inArray(
                  workspaceReservations.checkoutSessionKey,
                  checkoutSessionKeys
                )
              )
              .orderBy(desc(workspaceReservations.createdAt))
              .limit(1);
            return reservation?.checkoutSessionKey ?? null;
          },
          (effect, checkoutSessionKeys) =>
            effect.pipe(
              Effect.annotateLogs({
                checkoutSessionKey: checkoutSessionKeys[0],
              })
            )
        ),
        findLatestByAgentSelectionKey: Effect.fn(
          "workspaceReservations.findLatestByAgentSelectionKey"
        )(function* (input) {
          const rows = yield* db
            .select()
            .from(workspaceReservations)
            .where(
              and(
                eq(
                  workspaceReservations.agentSelectionKey,
                  input.agentSelectionKey
                ),
                eq(workspaceReservations.authorAccountId, input.authorAccountId)
              )
            )
            .orderBy(
              desc(workspaceReservations.createdAt),
              desc(workspaceReservations.id)
            )
            .limit(2);
          return yield* Effect.forEach(rows, decodeWorkspaceReservation);
        }),
        findSupersedableByAgentClient: Effect.fn(
          "workspaceReservations.findSupersedableByAgentClient"
        )(function* (input) {
          const rows = yield* db
            .select()
            .from(workspaceReservations)
            .where(
              and(
                eq(
                  workspaceReservations.authorAccountId,
                  input.authorAccountId
                ),
                eq(workspaceReservations.agentClientId, input.agentClientId),
                eq(workspaceReservations.reservationState, "held"),
                inArray(
                  workspaceReservations.paymentState,
                  supersedableReservationPaymentStates
                )
              )
            )
            .orderBy(
              desc(workspaceReservations.createdAt),
              desc(workspaceReservations.id)
            );
          return yield* Effect.forEach(rows, decodeWorkspaceReservation);
        }),
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
                inArray(workspaceReservations.reservationState, [
                  "draft",
                  "held",
                ])
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
          const claim = transaction(
            Effect.gen(function* () {
              const now = Temporal.Now.instant();
              const [grant] = yield* db
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

              const [claimed] = yield* db
                .update(workspaceReservations)
                .set({
                  reservationState: "cancelling",
                  ...(input.pendingPaymentCancellation && {
                    paymentState: "cancelled" as const,
                    failureCode: input.pendingPaymentCancellation.failureCode,
                  }),
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
                        eq(
                          workspaceReservations.reservationState,
                          "cancelling"
                        ),
                        lte(
                          workspaceReservations.updatedAt,
                          input.staleCancellingBefore
                        )
                      )
                    ),
                    input.pendingPaymentCancellation
                      ? and(
                          eq(workspaceReservations.paymentState, "pending"),
                          eq(
                            workspaceReservations.activePaymentAttemptId,
                            input.pendingPaymentCancellation.paymentAttemptId
                          )
                        )
                      : sql`${workspaceReservations.paymentState} <> 'pending'`,
                    sql`${workspaceReservations.fulfillmentState} <> 'processing'`,
                    sql`${workspaceReservations.fulfillmentState} <> 'awaiting_delivery'`
                  )
                )
                .returning();
              if (!claimed) return null;

              if (input.pendingPaymentCancellation) {
                const [attempt] = yield* db
                  .update(paymentAttempts)
                  .set({
                    state: "cancelled",
                    failureCode: input.pendingPaymentCancellation.failureCode,
                    updatedAt: now,
                  })
                  .where(
                    and(
                      eq(
                        paymentAttempts.id,
                        input.pendingPaymentCancellation.paymentAttemptId
                      ),
                      eq(paymentAttempts.workspaceReservationId, input.id),
                      inArray(paymentAttempts.state, [
                        "created",
                        "pending",
                        "cancelled",
                      ])
                    )
                  )
                  .returning({ id: paymentAttempts.id });
                if (!attempt) {
                  return yield* new WorkspaceReservationStateError({
                    operation:
                      "workspaceReservations.claimAdministrationCancellation",
                    reservationId: input.id,
                    message:
                      "The active payment attempt could not be cancelled.",
                  });
                }
                yield* releaseCodeClaim(
                  input.pendingPaymentCancellation.paymentAttemptId,
                  now,
                  input.pendingPaymentCancellation.failureCode
                );
              }

              if (
                grant &&
                ["issued", "uncertain", "provisioning"].includes(grant.state)
              ) {
                yield* db
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
          return yield* claim;
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
          const cancellation = transaction(
            Effect.gen(function* () {
              const updatedAt = Temporal.Now.instant();
              const updated = yield* db
                .update(workspaceReservations)
                .set({
                  reservationState: "cancelled",
                  reservationCancelledAt: input.cancelledAt,
                  failureCode: input.failureCode,
                  updatedAt,
                })
                .where(
                  and(
                    eq(workspaceReservations.id, input.id),
                    eq(workspaceReservations.reservationState, "cancelling"),
                    eq(workspaceReservations.updatedAt, input.claimedAt)
                  )
                )
                .returning({
                  id: workspaceReservations.id,
                  dotyposCustomerId: workspaceReservations.dotyposCustomerId,
                  reservationConfirmedAt:
                    workspaceReservations.reservationConfirmedAt,
                });
              yield* ensureUpdated(
                updated,
                "workspaceReservations.markAdministrationCancelled",
                input.id,
                "Only an operator-cancelled reservation can be marked cancelled."
              );
              const [cancelled] = updated;
              // Only a booked reservation's cancellation is a customer event;
              // an unconfirmed one was never booked.
              if (cancelled?.reservationConfirmedAt) {
                yield* recordCustomerEvent({
                  kind: "reservation-cancelled",
                  occurredAt: input.cancelledAt,
                  dotyposCustomerId: cancelled.dotyposCustomerId,
                  workspaceReservationId: input.id,
                });
              }
              yield* db
                .update(paymentAttempts)
                .set({ refundState: "required", updatedAt })
                .where(
                  and(
                    eq(paymentAttempts.workspaceReservationId, input.id),
                    eq(paymentAttempts.provider, "nexi"),
                    eq(paymentAttempts.state, "paid"),
                    // A refund Nexi already reported stays recorded.
                    eq(paymentAttempts.refundState, "not_required")
                  )
                );
            })
          );
          yield* cancellation;
        }),
        completeSupersessionAndCreateDraft: Effect.fn(
          "workspaceReservations.completeSupersessionAndCreateDraft"
        )(function* (input) {
          const supersession = transaction(
            Effect.gen(function* () {
              const [cancelled] = yield* db
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

              const [replacement] = yield* db
                .insert(workspaceReservations)
                .values({
                  id: postgresUuidV7,
                  checkoutSessionKey: input.replacement.checkoutSessionKey,
                  checkoutAttemptKey: input.replacement.checkoutAttemptKey,
                  correlationId: postgresUuidV7,
                  dotyposCustomerId: input.replacement.dotyposCustomerId,
                  authorAccountId: input.replacement.authorAccountId,
                  agentClientId: input.replacement.agentClientId ?? null,
                  agentSelectionKey:
                    input.replacement.agentSelectionKey ?? null,
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

          return yield* supersession.pipe(
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
        markReservationConfirmed: Effect.fn(
          "workspaceReservations.markReservationConfirmed"
        )(function* (input) {
          const confirmation = transaction(
            Effect.gen(function* () {
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
                .returning({
                  id: workspaceReservations.id,
                  dotyposCustomerId: workspaceReservations.dotyposCustomerId,
                });
              yield* ensureUpdated(
                updated,
                "workspaceReservations.markReservationConfirmed",
                input.id,
                "Only processing paid held reservations can be marked confirmed."
              );
              const [confirmed] = updated;
              if (confirmed) {
                yield* recordCustomerEvent({
                  kind: "reservation-booked",
                  occurredAt: input.confirmedAt,
                  dotyposCustomerId: confirmed.dotyposCustomerId,
                  workspaceReservationId: input.id,
                });
              }
            })
          );
          yield* confirmation;
        }),
        selectExpiredHolds: Effect.fn(
          "workspaceReservations.selectExpiredHolds"
        )(
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
              .limit(input.limit)
              .pipe(retryDatabaseRead);
            return yield* Effect.forEach(
              reservations,
              decodeWorkspaceReservation
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
      } satisfies IWorkspaceReservationRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

export const decodeOptionalWorkspaceReservation = (
  reservation: WorkspaceReservationRow | undefined
) =>
  reservation ? decodeWorkspaceReservation(reservation) : Effect.succeed(null);

const decodeWorkspaceReservation = (reservation: WorkspaceReservationRow) =>
  StoredReservationDetails.decodeRow(reservation).pipe(
    Effect.map(withReservationKindFields)
  );
