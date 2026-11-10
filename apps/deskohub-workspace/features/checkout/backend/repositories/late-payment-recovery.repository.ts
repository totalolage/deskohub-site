import "@/shared/polyfills/temporal";

import type { DotyposReservationId } from "@deskohub/dotypos";
import type { NexiOperationId, NexiWebhookEventId } from "@deskohub/nexi";
import { and, asc, desc, eq, gt, inArray, lte, ne, or, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase, WorkspaceTransaction } from "@/db/database.service";
import { equalsAny } from "@/db/equals-any";
import {
  type LatePaymentRecovery,
  type LatePaymentRecoveryState,
  latePaymentRecoveries,
  type PaymentRefundState,
  paymentAttempts,
  type WorkspaceReservationRow,
  workspaceReservations,
} from "@/db/schema";
import { WorkspaceLocks } from "@/db/workspace-locks";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { DiscountClaimError } from "@/features/discounts/errors";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { recordCustomerEvent } from "@/shared/backend/customer-events/customer-event-outbox";
import {
  type ReadLimitExceededError,
  readLimitSentinel,
  requireWithinReadLimit,
} from "@/shared/backend/read-limit";
import {
  attemptRecordsReferral,
  ensureReferralFirstPaidTransition,
  redeemCodeClaim,
  redeemReferralInvitationClaim,
} from "./payment-lifecycle.repository";

/**
 * Availability and table assignment treat an unpaid hold past its deadline as
 * free inventory, so a late payment may reuse its original hold only while the
 * deadline is still this far away. The margin keeps a concurrent availability
 * check on another instance from observing the hold as expired before the
 * recovery transaction marks it paid.
 */
export const reusableHoldMinimumRemaining = Temporal.Duration.from({
  minutes: 1,
});

export class LatePaymentRecoveryStateError extends Data.TaggedError(
  "LatePaymentRecoveryStateError"
)<{
  readonly operation: string;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly message: string;
}> {}

/**
 * The original hold stopped being reusable (its deadline reached the safety
 * margin or its local state changed) before the settlement acquired its lock.
 * Recovery continues by releasing the hold and creating the reservation again.
 */
export class OriginalHoldNotReusableError extends Data.TaggedError(
  "OriginalHoldNotReusableError"
)<{
  readonly paymentAttemptId: PaymentAttemptId;
  readonly message: string;
}> {}

type LatePaymentProviderFacts = {
  /** Absent when the status page's provider verification found the payment. */
  readonly webhookEventId?: NexiWebhookEventId;
  readonly providerOperationId?: NexiOperationId;
  readonly providerStatus?: string;
  readonly verifiedPaidAt: Temporal.Instant;
};

type RecoverySettlementInput = {
  readonly paymentAttemptId: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId;
};

type RecoverySettlement = RecoverySettlementInput & {
  readonly state: "recovered" | "refund_required" | "review_required";
  readonly failureCode?: string;
  readonly recoveredDotyposReservationId?: DotyposReservationId;
  readonly reservationState?: "confirmed" | "held";
  readonly completedAt: Temporal.Instant;
};

type LatePaymentRecoveryRepositoryError =
  | DiscountClaimError
  | EffectDrizzleQueryError
  | LatePaymentRecoveryStateError
  | OriginalHoldNotReusableError
  | SqlError;

/**
 * A late-payment recovery as the customer may see it: when the late payment
 * was verified and how the recovery ended. Leaves out provider webhook and
 * operation ids, provider statuses, Dotypos reservation ids and failure codes.
 */
export type CustomerLatePaymentRecoveryRecord = {
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly state: LatePaymentRecoveryState;
  readonly verifiedPaidAt: Temporal.Instant;
  /** `null` while the recovery is pending or processing. */
  readonly completedAt: Temporal.Instant | null;
};

export interface ILatePaymentRecoveryRepository {
  readonly start: (
    input: RecoverySettlementInput & LatePaymentProviderFacts
  ) => Effect.Effect<LatePaymentRecovery, LatePaymentRecoveryRepositoryError>;
  readonly findByPaymentAttemptId: (
    paymentAttemptId: PaymentAttemptId
  ) => Effect.Effect<LatePaymentRecovery | null, EffectDrizzleQueryError>;
  readonly findLatestByWorkspaceReservationId: (
    workspaceReservationId: WorkspaceReservationId
  ) => Effect.Effect<LatePaymentRecovery | null, EffectDrizzleQueryError>;
  /**
   * Every late-payment recovery of the given reservations, oldest first. The
   * caller owns the reservations' customer scope and the `limit`, which
   * bounds the whole result: more matching recoveries fail with
   * `ReadLimitExceededError` and return nothing.
   */
  readonly listForReservations: (input: {
    readonly workspaceReservationIds: readonly WorkspaceReservationId[];
    readonly limit: number;
  }) => Effect.Effect<
    readonly CustomerLatePaymentRecoveryRecord[],
    EffectDrizzleQueryError | ReadLimitExceededError
  >;
  readonly claim: (input: {
    readonly paymentAttemptId: PaymentAttemptId;
    readonly staleProcessingBefore: Temporal.Instant;
  }) => Effect.Effect<LatePaymentRecovery | null, EffectDrizzleQueryError>;
  readonly hasNewerActiveReservation: (
    workspaceReservationId: WorkspaceReservationId
  ) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  readonly completeUsingOriginalReservation: (
    input: RecoverySettlementInput & {
      readonly reservationState: "confirmed" | "held";
      readonly completedAt: Temporal.Instant;
    }
  ) => Effect.Effect<void, LatePaymentRecoveryRepositoryError>;
  readonly completeWithReplacement: (
    input: RecoverySettlementInput & {
      readonly recoveredDotyposReservationId: DotyposReservationId;
      readonly reservationState: "confirmed" | "held";
      readonly completedAt: Temporal.Instant;
    }
  ) => Effect.Effect<void, LatePaymentRecoveryRepositoryError>;
  readonly requireRefund: (
    input: RecoverySettlementInput & {
      readonly failureCode: string;
      readonly completedAt: Temporal.Instant;
    }
  ) => Effect.Effect<void, LatePaymentRecoveryRepositoryError>;
  readonly requireReview: (
    input: RecoverySettlementInput & {
      readonly failureCode: string;
      readonly completedAt: Temporal.Instant;
    }
  ) => Effect.Effect<void, LatePaymentRecoveryRepositoryError>;
}

export class LatePaymentRecoveryRepository extends Context.Service<
  LatePaymentRecoveryRepository,
  ILatePaymentRecoveryRepository
>()("@deskohub-workspace/checkout/LatePaymentRecoveryRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;

      const findByPaymentAttemptId = Effect.fn(
        "LatePaymentRecoveryRepository.findByPaymentAttemptId"
      )(function* (paymentAttemptId: PaymentAttemptId) {
        const [recovery] = yield* db
          .select()
          .from(latePaymentRecoveries)
          .where(eq(latePaymentRecoveries.paymentAttemptId, paymentAttemptId))
          .limit(1);
        return recovery ?? null;
      });

      const settle = Effect.fn("LatePaymentRecoveryRepository.settle")(
        function* (input: RecoverySettlement) {
          yield* transaction(
            Effect.gen(function* () {
              const recovery = yield* lockSettlementRecovery(input);
              if (recovery.state === input.state) return;
              if (recovery.state !== "processing") {
                return yield* recoveryStateError(
                  "settle",
                  input.paymentAttemptId,
                  "Only a processing late-payment recovery can settle."
                );
              }

              const reservation = yield* lockSettlementReservation(input);
              const isActiveAttempt =
                reservation.activePaymentAttemptId === input.paymentAttemptId;
              yield* requireSettlingAttempt(input, isActiveAttempt);
              yield* requireSettlementHold(input, reservation);

              if (input.state === "recovered") {
                yield* requireNoNewerCheckoutReservation(input, reservation);
                yield* ensureReferralFirstPaidTransition({
                  dotyposCustomerId: reservation.dotyposCustomerId,
                  workspaceReservationId: input.workspaceReservationId,
                  paymentAttemptId: input.paymentAttemptId,
                });
              }

              yield* markLatePaymentAttemptPaid(input, recovery);

              if (input.state === "recovered") {
                yield* redeemCodeClaim(
                  input.paymentAttemptId,
                  recovery.verifiedPaidAt,
                  true
                );
                yield* redeemReferralInvitationClaim(
                  input.paymentAttemptId,
                  input.workspaceReservationId,
                  recovery.verifiedPaidAt,
                  true
                );
              }

              if (isActiveAttempt) {
                yield* settleActiveReservation(input, recovery);
              }

              yield* markRecoverySettled(input, recovery);
            })
          );
        }
      );
      return {
        findByPaymentAttemptId,
        findLatestByWorkspaceReservationId: Effect.fn(
          "LatePaymentRecoveryRepository.findLatestByWorkspaceReservationId"
        )(function* (workspaceReservationId) {
          const [recovery] = yield* db
            .select()
            .from(latePaymentRecoveries)
            .where(
              eq(
                latePaymentRecoveries.workspaceReservationId,
                workspaceReservationId
              )
            )
            .orderBy(
              desc(latePaymentRecoveries.createdAt),
              desc(latePaymentRecoveries.paymentAttemptId)
            )
            .limit(1);
          return recovery ?? null;
        }),
        listForReservations: Effect.fn(
          "LatePaymentRecoveryRepository.listForReservations"
        )(function* (input) {
          if (input.workspaceReservationIds.length === 0) return [];

          const rows = yield* db
            .select({
              workspaceReservationId:
                latePaymentRecoveries.workspaceReservationId,
              state: latePaymentRecoveries.state,
              verifiedPaidAt: latePaymentRecoveries.verifiedPaidAt,
              completedAt: latePaymentRecoveries.completedAt,
            })
            .from(latePaymentRecoveries)
            .where(
              equalsAny(
                latePaymentRecoveries.workspaceReservationId,
                input.workspaceReservationIds
              )
            )
            .orderBy(
              asc(latePaymentRecoveries.createdAt),
              asc(latePaymentRecoveries.paymentAttemptId)
            )
            .limit(readLimitSentinel(input.limit));
          return yield* requireWithinReadLimit(rows, input.limit);
        }),
        start: Effect.fn("LatePaymentRecoveryRepository.start")(
          function* (input) {
            return yield* transaction(
              Effect.gen(function* () {
                const dotyposCustomerId = yield* findRecoveryCustomer(
                  "start",
                  input
                );
                yield* WorkspaceLocks.referralFirstBooking(dotyposCustomerId);
                // Lock the attempt before looking for an existing recovery so
                // a concurrent webhook and status-page verification serialize
                // here and the later one observes the committed recovery.
                const [attempt] = yield* db
                  .select({ state: paymentAttempts.state })
                  .from(paymentAttempts)
                  .where(
                    and(
                      eq(paymentAttempts.id, input.paymentAttemptId),
                      eq(
                        paymentAttempts.workspaceReservationId,
                        input.workspaceReservationId
                      )
                    )
                  )
                  .limit(1)
                  .for("update");

                const [existing] = yield* db
                  .select()
                  .from(latePaymentRecoveries)
                  .where(
                    eq(
                      latePaymentRecoveries.paymentAttemptId,
                      input.paymentAttemptId
                    )
                  )
                  .limit(1);
                if (existing) {
                  yield* linkLateWebhookToAttempt(input, existing);
                  return existing;
                }

                const [reservation] = yield* db
                  .select()
                  .from(workspaceReservations)
                  .where(
                    eq(workspaceReservations.id, input.workspaceReservationId)
                  )
                  .limit(1)
                  .for("update");
                if (
                  !(
                    attempt &&
                    isLateSettledAttemptState(attempt.state) &&
                    reservation?.dotyposReservationId
                  )
                ) {
                  return yield* recoveryStateError(
                    "start",
                    input.paymentAttemptId,
                    "Late-payment recovery requires a terminal attempt and its Dotypos reservation."
                  );
                }

                const [recovery] = yield* db
                  .insert(latePaymentRecoveries)
                  .values({
                    paymentAttemptId: input.paymentAttemptId,
                    workspaceReservationId: input.workspaceReservationId,
                    webhookEventId: input.webhookEventId,
                    providerOperationId: input.providerOperationId,
                    providerStatus: input.providerStatus,
                    state: "pending",
                    originalDotyposReservationId:
                      reservation.dotyposReservationId,
                    verifiedPaidAt: input.verifiedPaidAt,
                  })
                  .returning();
                if (!recovery) {
                  return yield* Effect.die(
                    "Late-payment recovery insert returned no row."
                  );
                }
                return recovery;
              })
            );
          }
        ),
        claim: Effect.fn("LatePaymentRecoveryRepository.claim")(
          function* (input) {
            const claimedAt = Temporal.Now.instant();
            const [claimed] = yield* db
              .update(latePaymentRecoveries)
              .set({
                state: "processing",
                claimedAt,
                updatedAt: claimedAt,
              })
              .where(
                and(
                  eq(
                    latePaymentRecoveries.paymentAttemptId,
                    input.paymentAttemptId
                  ),
                  or(
                    eq(latePaymentRecoveries.state, "pending"),
                    and(
                      eq(latePaymentRecoveries.state, "processing"),
                      lte(
                        latePaymentRecoveries.claimedAt,
                        input.staleProcessingBefore
                      )
                    )
                  )
                )
              )
              .returning();
            return claimed ?? null;
          }
        ),
        hasNewerActiveReservation: Effect.fn(
          "LatePaymentRecoveryRepository.hasNewerActiveReservation"
        )(function* (workspaceReservationId) {
          const [reservation] = yield* db
            .select({
              checkoutSessionKey: workspaceReservations.checkoutSessionKey,
              createdAt: workspaceReservations.createdAt,
            })
            .from(workspaceReservations)
            .where(eq(workspaceReservations.id, workspaceReservationId))
            .limit(1);
          if (!reservation) return false;
          const [newer] = yield* db
            .select({ id: workspaceReservations.id })
            .from(workspaceReservations)
            .where(
              and(
                eq(
                  workspaceReservations.checkoutSessionKey,
                  reservation.checkoutSessionKey
                ),
                ne(workspaceReservations.id, workspaceReservationId),
                gt(workspaceReservations.createdAt, reservation.createdAt),
                ne(workspaceReservations.reservationState, "cancelled")
              )
            )
            .limit(1);
          return Boolean(newer);
        }),
        completeUsingOriginalReservation: Effect.fn(
          "LatePaymentRecoveryRepository.completeUsingOriginalReservation"
        )((input) =>
          settle({
            ...input,
            state: "recovered",
          })
        ),
        completeWithReplacement: Effect.fn(
          "LatePaymentRecoveryRepository.completeWithReplacement"
        )((input) =>
          settle({
            ...input,
            state: "recovered",
          })
        ),
        requireRefund: Effect.fn("LatePaymentRecoveryRepository.requireRefund")(
          (input) =>
            settle({
              ...input,
              state: "refund_required",
            })
        ),
        requireReview: Effect.fn("LatePaymentRecoveryRepository.requireReview")(
          (input) =>
            settle({
              ...input,
              state: "review_required",
            })
        ),
      } satisfies ILatePaymentRecoveryRepository;
    })
  );
}

/** Reads the reservation's customer, whose first-booking lock comes next. */
const findRecoveryCustomer = Effect.fnUntraced(function* (
  operation: "start" | "settle",
  input: RecoverySettlementInput
) {
  const { db } = yield* WorkspaceTransaction;
  const [reservationIdentity] = yield* db
    .select({
      dotyposCustomerId: workspaceReservations.dotyposCustomerId,
    })
    .from(workspaceReservations)
    .where(eq(workspaceReservations.id, input.workspaceReservationId))
    .limit(1);
  if (!reservationIdentity) {
    return yield* recoveryStateError(
      operation,
      input.paymentAttemptId,
      "Late-payment reservation was not found."
    );
  }
  return reservationIdentity.dotyposCustomerId;
});

/** Takes settlement's locks in order, then locks the recovery row. */
const lockSettlementRecovery = Effect.fnUntraced(function* (
  input: RecoverySettlementInput
) {
  const { db } = yield* WorkspaceTransaction;
  const dotyposCustomerId = yield* findRecoveryCustomer("settle", input);
  // A transition that may record a referral attribution takes the
  // graph lock first, matching acceptReferral's lock order.
  if (yield* attemptRecordsReferral(input.paymentAttemptId)) {
    yield* WorkspaceLocks.referralGraph();
  }
  yield* WorkspaceLocks.referralFirstBooking(dotyposCustomerId);

  const [recovery] = yield* db
    .select()
    .from(latePaymentRecoveries)
    .where(
      and(
        eq(latePaymentRecoveries.paymentAttemptId, input.paymentAttemptId),
        eq(
          latePaymentRecoveries.workspaceReservationId,
          input.workspaceReservationId
        )
      )
    )
    .limit(1)
    .for("update");
  if (!recovery) {
    return yield* recoveryStateError(
      "settle",
      input.paymentAttemptId,
      "Late-payment recovery was not found."
    );
  }
  return recovery;
});

const lockSettlementReservation = Effect.fnUntraced(function* (
  input: RecoverySettlementInput
) {
  const { db } = yield* WorkspaceTransaction;
  const [reservation] = yield* db
    .select()
    .from(workspaceReservations)
    .where(eq(workspaceReservations.id, input.workspaceReservationId))
    .limit(1)
    .for("update");
  if (!reservation) {
    return yield* recoveryStateError(
      "settle",
      input.paymentAttemptId,
      "Late-payment reservation was not found."
    );
  }
  return reservation;
});

/** A superseded attempt can only settle as a refund. */
const requireSettlingAttempt = (
  input: RecoverySettlement,
  isActiveAttempt: boolean
) =>
  !isActiveAttempt && input.state !== "refund_required"
    ? Effect.fail(
        recoveryStateError(
          "settle",
          input.paymentAttemptId,
          "Only an active payment attempt can recover the reservation."
        )
      )
    : Effect.void;

/**
 * Reusing the original hold needs it still reusable; attaching a replacement
 * needs the original reservation released.
 */
const requireSettlementHold = (
  input: RecoverySettlement,
  reservation: WorkspaceReservationRow
) => {
  if (
    input.reservationState &&
    !input.recoveredDotyposReservationId &&
    !isReusableHold(reservation, Temporal.Now.instant())
  ) {
    return Effect.fail(
      new OriginalHoldNotReusableError({
        paymentAttemptId: input.paymentAttemptId,
        message:
          "The original hold may already have been offered as free inventory.",
      })
    );
  }
  if (
    input.recoveredDotyposReservationId &&
    reservation.reservationState !== "cancelled" &&
    reservation.reservationState !== "cancellation_failed"
  ) {
    return Effect.fail(
      recoveryStateError(
        "settle",
        input.paymentAttemptId,
        "A replacement can only attach after the original reservation is released."
      )
    );
  }
  return Effect.void;
};

const requireNoNewerCheckoutReservation = Effect.fnUntraced(function* (
  input: RecoverySettlementInput,
  reservation: WorkspaceReservationRow
) {
  const { db } = yield* WorkspaceTransaction;
  const [newer] = yield* db
    .select({ id: workspaceReservations.id })
    .from(workspaceReservations)
    .where(
      and(
        eq(
          workspaceReservations.checkoutSessionKey,
          reservation.checkoutSessionKey
        ),
        ne(workspaceReservations.id, reservation.id),
        gt(workspaceReservations.createdAt, reservation.createdAt),
        ne(workspaceReservations.reservationState, "cancelled")
      )
    )
    .limit(1);
  if (newer) {
    return yield* recoveryStateError(
      "settle",
      input.paymentAttemptId,
      "A newer active checkout-session reservation prevents recovery."
    );
  }
});

const markLatePaymentAttemptPaid = Effect.fnUntraced(function* (
  input: RecoverySettlement,
  recovery: LatePaymentRecovery
) {
  const { db } = yield* WorkspaceTransaction;
  const [attempt] = yield* db
    .update(paymentAttempts)
    .set({
      state: "paid",
      // A refund Nexi already reported stays recorded.
      ...(input.state === "refund_required" && {
        refundState: sql<PaymentRefundState>`case when ${paymentAttempts.refundState} = 'refunded' then 'refunded' else 'required' end`,
      }),
      ...(recovery.webhookEventId && {
        lastWebhookEventId: recovery.webhookEventId,
      }),
      lastProviderOperationId: recovery.providerOperationId,
      lastProviderStatus: recovery.providerStatus,
      failureCode: null,
      updatedAt: recovery.verifiedPaidAt,
    })
    .where(
      and(
        eq(paymentAttempts.id, input.paymentAttemptId),
        eq(
          paymentAttempts.workspaceReservationId,
          input.workspaceReservationId
        ),
        inArray(paymentAttempts.state, [
          "failed",
          "cancelled",
          "expired",
          "paid",
        ])
      )
    )
    .returning({ id: paymentAttempts.id });
  if (!attempt) {
    return yield* recoveryStateError(
      "settle",
      input.paymentAttemptId,
      "Only a terminal late payment can settle as paid."
    );
  }
});

/** The booking columns a settlement writes beside the payment columns. */
const settledReservationBooking = (
  input: RecoverySettlement
): Partial<typeof workspaceReservations.$inferInsert> => {
  if (input.recoveredDotyposReservationId) {
    return {
      dotyposReservationId: input.recoveredDotyposReservationId,
      reservationState: input.reservationState,
      reservationCreatedAt: input.completedAt,
      reservationConfirmedAt:
        input.reservationState === "confirmed" ? input.completedAt : null,
      reservationCancelledAt: null,
      reservationHoldExpiredAt: null,
    };
  }
  if (input.reservationState) {
    return {
      reservationState: input.reservationState,
      ...(input.reservationState === "confirmed" && {
        reservationConfirmedAt: input.completedAt,
      }),
    };
  }
  return {};
};

/** Marks the active attempt's reservation paid and records a confirmation. */
const settleActiveReservation = Effect.fnUntraced(function* (
  input: RecoverySettlement,
  recovery: LatePaymentRecovery
) {
  const { db } = yield* WorkspaceTransaction;
  const [updatedReservation] = yield* db
    .update(workspaceReservations)
    .set({
      ...settledReservationBooking(input),
      paymentState: "paid",
      paidAt: recovery.verifiedPaidAt,
      failureCode: input.failureCode ?? null,
      updatedAt: input.completedAt,
    })
    .where(
      and(
        eq(workspaceReservations.id, input.workspaceReservationId),
        eq(workspaceReservations.activePaymentAttemptId, input.paymentAttemptId)
      )
    )
    .returning({
      dotyposCustomerId: workspaceReservations.dotyposCustomerId,
      reservationConfirmedAt: workspaceReservations.reservationConfirmedAt,
    });
  if (!updatedReservation) {
    return yield* recoveryStateError(
      "settle",
      input.paymentAttemptId,
      "Late-payment reservation settlement failed."
    );
  }
  if (
    input.reservationState === "confirmed" &&
    updatedReservation.reservationConfirmedAt
  ) {
    yield* recordCustomerEvent({
      kind: "reservation-booked",
      occurredAt: updatedReservation.reservationConfirmedAt,
      dotyposCustomerId: updatedReservation.dotyposCustomerId,
      workspaceReservationId: input.workspaceReservationId,
    });
  }
});

const markRecoverySettled = Effect.fnUntraced(function* (
  input: RecoverySettlement,
  recovery: LatePaymentRecovery
) {
  const { db } = yield* WorkspaceTransaction;
  yield* db
    .update(latePaymentRecoveries)
    .set({
      state: input.state,
      recoveredDotyposReservationId:
        input.recoveredDotyposReservationId ??
        (input.state === "recovered"
          ? recovery.originalDotyposReservationId
          : null),
      failureCode: input.failureCode ?? null,
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
    })
    .where(
      and(
        eq(latePaymentRecoveries.paymentAttemptId, input.paymentAttemptId),
        eq(latePaymentRecoveries.state, "processing")
      )
    );
});

/**
 * A webhook arriving after status-page verification started the recovery
 * still identifies the payment; link it to the attempt already locked here
 * rather than the recovery, whose row settlement locks before the attempt.
 */
const linkLateWebhookToAttempt = Effect.fnUntraced(function* (
  input: RecoverySettlementInput & LatePaymentProviderFacts,
  existing: LatePaymentRecovery
) {
  const { db } = yield* WorkspaceTransaction;
  if (input.webhookEventId && !existing.webhookEventId) {
    yield* db
      .update(paymentAttempts)
      .set({ lastWebhookEventId: input.webhookEventId })
      .where(eq(paymentAttempts.id, input.paymentAttemptId));
  }
});

const isLateSettledAttemptState = (state: string) =>
  state === "failed" || state === "cancelled" || state === "expired";

/**
 * Only a still-held reservation whose deadline has not been reached (with the
 * safety margin) was never visible as free inventory, so only it may be reused
 * without running the normal availability check and table assignment again.
 */
export const isReusableHold = (
  reservation: {
    readonly reservationState: string;
    readonly reservationHoldExpiresAt: Temporal.Instant | null;
  },
  now: Temporal.Instant
) =>
  reservation.reservationState === "held" &&
  reservation.reservationHoldExpiresAt !== null &&
  Temporal.Instant.compare(
    reservation.reservationHoldExpiresAt,
    now.add(reusableHoldMinimumRemaining)
  ) > 0;

const recoveryStateError = (
  operation: string,
  paymentAttemptId: PaymentAttemptId,
  message: string
) =>
  new LatePaymentRecoveryStateError({
    operation: `LatePaymentRecoveryRepository.${operation}`,
    paymentAttemptId,
    message,
  });
