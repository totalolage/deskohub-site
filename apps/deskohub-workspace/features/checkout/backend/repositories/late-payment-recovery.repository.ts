import type { DotyposReservationId } from "@deskohub/dotypos";
import type { NexiOperationId, NexiWebhookEventId } from "@deskohub/nexi";
import { and, eq, gt, inArray, isNull, lte, ne, or } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import {
  type LatePaymentRecovery,
  latePaymentRecoveries,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { DiscountClaimError } from "@/features/discounts/errors";
import { orderIdSchema } from "@/features/order";
import { ensureReservationOrder } from "@/features/order/backend/reservation-order";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { redeemCodeClaim } from "./payment-lifecycle.repository";

export class LatePaymentRecoveryStateError extends Data.TaggedError(
  "LatePaymentRecoveryStateError"
)<{
  readonly operation: string;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly message: string;
}> {}

type LatePaymentProviderFacts = {
  readonly webhookEventId: NexiWebhookEventId;
  readonly providerOperationId?: NexiOperationId;
  readonly providerStatus?: string;
  readonly verifiedPaidAt: Temporal.Instant;
};

type RecoverySettlementInput = {
  readonly paymentAttemptId: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId;
};

type TransactionClient = Parameters<
  Parameters<WorkspaceDatabaseClient["transaction"]>[0]
>[0];

type LatePaymentRecoveryRepositoryError =
  | DiscountClaimError
  | EffectDrizzleQueryError
  | LatePaymentRecoveryStateError
  | SqlError;

export interface ILatePaymentRecoveryRepository {
  readonly start: (
    input: RecoverySettlementInput & LatePaymentProviderFacts
  ) => Effect.Effect<LatePaymentRecovery, LatePaymentRecoveryRepositoryError>;
  readonly findByPaymentAttemptId: (
    paymentAttemptId: PaymentAttemptId
  ) => Effect.Effect<LatePaymentRecovery | null, EffectDrizzleQueryError>;
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
      const { db } = yield* WorkspaceDatabase;

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

      const relinkLegacyAttemptOrder = Effect.fn(
        "LatePaymentRecoveryRepository.relinkLegacyAttemptOrder"
      )(function* (input: {
        readonly tx: TransactionClient;
        readonly paymentAttemptId: PaymentAttemptId;
        readonly workspaceReservationId: WorkspaceReservationId;
      }) {
        yield* input.tx
          .update(paymentAttempts)
          .set({
            orderId: orderIdSchema.make(input.workspaceReservationId) as never,
          })
          .where(
            and(
              eq(paymentAttempts.id, input.paymentAttemptId),
              isNull(paymentAttempts.orderId)
            )
          );
      });

      const settle = Effect.fn("LatePaymentRecoveryRepository.settle")(
        function* (
          input: RecoverySettlementInput & {
            readonly state: "recovered" | "refund_required" | "review_required";
            readonly failureCode?: string;
            readonly recoveredDotyposReservationId?: DotyposReservationId;
            readonly reservationState?: "confirmed" | "held";
            readonly completedAt: Temporal.Instant;
          }
        ) {
          yield* db.transaction(
            Effect.fn(function* (tx) {
              const [recovery] = yield* tx
                .select()
                .from(latePaymentRecoveries)
                .where(
                  and(
                    eq(
                      latePaymentRecoveries.paymentAttemptId,
                      input.paymentAttemptId
                    ),
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
              const alreadySettled = recovery.state === input.state;
              if (!alreadySettled && recovery.state !== "processing") {
                return yield* recoveryStateError(
                  "settle",
                  input.paymentAttemptId,
                  "Only a processing late-payment recovery can settle."
                );
              }

              // Lock-order contract: payment attempt → reservation → order.
              // The NO KEY UPDATE anchor serializes with deployed FOR UPDATE
              // recovery writers and new reservation mirrors while remaining
              // compatible with orders.active_payment_attempt_id's FK
              // KEY SHARE check. The later order_id relink upgrades this
              // already-held lock only after the reservation mirror exists.
              const [attemptAnchor] = yield* tx
                .select({ id: paymentAttempts.id })
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
                .for("no key update");
              if (!attemptAnchor) {
                return yield* recoveryStateError(
                  "settle",
                  input.paymentAttemptId,
                  "Late-payment attempt was not found."
                );
              }

              const [reservation] = yield* tx
                .select()
                .from(workspaceReservations)
                .where(
                  eq(workspaceReservations.id, input.workspaceReservationId)
                )
                .limit(1)
                .for("update");
              if (!reservation) {
                return yield* recoveryStateError(
                  "settle",
                  input.paymentAttemptId,
                  "Late-payment reservation was not found."
                );
              }
              yield* ensureReservationOrder({ tx, reservation });
              if (alreadySettled) {
                yield* relinkLegacyAttemptOrder({
                  tx,
                  paymentAttemptId: input.paymentAttemptId,
                  workspaceReservationId: input.workspaceReservationId,
                });
                return;
              }

              const isActiveAttempt =
                reservation.activePaymentAttemptId === input.paymentAttemptId;
              if (!isActiveAttempt && input.state !== "refund_required") {
                return yield* recoveryStateError(
                  "settle",
                  input.paymentAttemptId,
                  "Only an active payment attempt can recover the reservation."
                );
              }
              if (
                input.reservationState &&
                !input.recoveredDotyposReservationId &&
                reservation.reservationState !== "held" &&
                reservation.reservationState !== "cancellation_failed"
              ) {
                return yield* recoveryStateError(
                  "settle",
                  input.paymentAttemptId,
                  "The original reservation can no longer be safely recovered."
                );
              }
              if (
                input.recoveredDotyposReservationId &&
                reservation.reservationState !== "cancelled" &&
                reservation.reservationState !== "cancellation_failed"
              ) {
                return yield* recoveryStateError(
                  "settle",
                  input.paymentAttemptId,
                  "A replacement can only attach after the original reservation is released."
                );
              }

              if (input.state === "recovered") {
                const [newer] = yield* tx
                  .select({ id: workspaceReservations.id })
                  .from(workspaceReservations)
                  .where(
                    and(
                      eq(
                        workspaceReservations.checkoutSessionKey,
                        reservation.checkoutSessionKey
                      ),
                      ne(workspaceReservations.id, reservation.id),
                      gt(
                        workspaceReservations.createdAt,
                        reservation.createdAt
                      ),
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
              }

              const [attempt] = yield* tx
                .update(paymentAttempts)
                .set({
                  state: "paid",
                  ...(input.state === "refund_required" && {
                    refundState: "required",
                  }),
                  lastWebhookEventId: recovery.webhookEventId,
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
              yield* relinkLegacyAttemptOrder({
                tx,
                paymentAttemptId: input.paymentAttemptId,
                workspaceReservationId: input.workspaceReservationId,
              });

              if (input.state === "recovered") {
                yield* redeemCodeClaim(
                  tx,
                  input.paymentAttemptId,
                  recovery.verifiedPaidAt,
                  true
                );
              }

              if (isActiveAttempt) {
                let reservationValues = {};
                if (input.recoveredDotyposReservationId) {
                  reservationValues = {
                    dotyposReservationId: input.recoveredDotyposReservationId,
                    reservationState: input.reservationState,
                    reservationCreatedAt: input.completedAt,
                    reservationConfirmedAt:
                      input.reservationState === "confirmed"
                        ? input.completedAt
                        : null,
                    reservationCancelledAt: null,
                    reservationHoldExpiredAt: null,
                  };
                } else if (input.reservationState) {
                  reservationValues = {
                    reservationState: input.reservationState,
                    ...(input.reservationState === "confirmed" && {
                      reservationConfirmedAt: input.completedAt,
                    }),
                  };
                }
                const [updatedReservation] = yield* tx
                  .update(workspaceReservations)
                  .set({
                    ...reservationValues,
                    paymentState: "paid",
                    paidAt: recovery.verifiedPaidAt,
                    failureCode: input.failureCode ?? null,
                    updatedAt: input.completedAt,
                  })
                  .where(
                    and(
                      eq(
                        workspaceReservations.id,
                        input.workspaceReservationId
                      ),
                      eq(
                        workspaceReservations.activePaymentAttemptId,
                        input.paymentAttemptId
                      )
                    )
                  )
                  .returning();
                if (!updatedReservation) {
                  return yield* recoveryStateError(
                    "settle",
                    input.paymentAttemptId,
                    "Late-payment reservation settlement failed."
                  );
                }
                yield* ensureReservationOrder({
                  tx,
                  reservation: updatedReservation,
                });
              }

              yield* tx
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
                    eq(
                      latePaymentRecoveries.paymentAttemptId,
                      input.paymentAttemptId
                    ),
                    eq(latePaymentRecoveries.state, "processing")
                  )
                );
            })
          );
        }
      );

      return {
        findByPaymentAttemptId,
        start: Effect.fn("LatePaymentRecoveryRepository.start")(
          function* (input) {
            return yield* db.transaction(
              Effect.fn(function* (tx) {
                const [existing] = yield* tx
                  .select()
                  .from(latePaymentRecoveries)
                  .where(
                    eq(
                      latePaymentRecoveries.paymentAttemptId,
                      input.paymentAttemptId
                    )
                  )
                  .limit(1)
                  .for("update");
                if (existing) {
                  if (
                    existing.workspaceReservationId !==
                    input.workspaceReservationId
                  ) {
                    return yield* recoveryStateError(
                      "start",
                      input.paymentAttemptId,
                      "Late-payment recovery belongs to a different reservation."
                    );
                  }

                  const [attempt] = yield* tx
                    .select({ id: paymentAttempts.id })
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
                    .for("no key update");
                  const [reservation] = yield* tx
                    .select()
                    .from(workspaceReservations)
                    .where(
                      eq(workspaceReservations.id, input.workspaceReservationId)
                    )
                    .limit(1)
                    .for("update");
                  if (!attempt || !reservation) {
                    return yield* recoveryStateError(
                      "start",
                      input.paymentAttemptId,
                      "Late-payment recovery requires its attempt and reservation."
                    );
                  }

                  yield* ensureReservationOrder({ tx, reservation });
                  yield* relinkLegacyAttemptOrder({
                    tx,
                    paymentAttemptId: input.paymentAttemptId,
                    workspaceReservationId: input.workspaceReservationId,
                  });
                  return existing;
                }

                // Lock-order contract: payment attempt → reservation →
                // order. The attempt-first anchor matches the deployed old
                // writers and the payment lifecycle writers, so old-new
                // overlap during a rolling deploy serializes instead of
                // inverting into a deadlock.
                // Lock mode: FOR NO KEY UPDATE. It conflicts with old
                // recovery FOR UPDATE locks and the new reservation-mirror
                // anchors, but remains compatible with the order FK's KEY
                // SHARE check. Reservation-only writers take their attempt
                // anchor before the reservation, so the order_id relink can
                // safely upgrade this lock without forming a cycle.
                const [attempt] = yield* tx
                  .select({ id: paymentAttempts.id })
                  .from(paymentAttempts)
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
                      ])
                    )
                  )
                  .limit(1)
                  .for("no key update");
                const [reservation] = yield* tx
                  .select()
                  .from(workspaceReservations)
                  .where(
                    eq(workspaceReservations.id, input.workspaceReservationId)
                  )
                  .limit(1)
                  .for("update");
                if (!(attempt && reservation?.dotyposReservationId)) {
                  return yield* recoveryStateError(
                    "start",
                    input.paymentAttemptId,
                    "Late-payment recovery requires a terminal attempt and its Dotypos reservation."
                  );
                }

                yield* ensureReservationOrder({ tx, reservation });
                yield* relinkLegacyAttemptOrder({
                  tx,
                  paymentAttemptId: input.paymentAttemptId,
                  workspaceReservationId: input.workspaceReservationId,
                });

                const [recovery] = yield* tx
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
