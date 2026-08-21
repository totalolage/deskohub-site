import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import type {
  NexiOperationId,
  NexiOrderId,
  NexiWebhookEventId,
} from "@deskohub/nexi";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Match, Predicate, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import {
  accountingDocumentSnapshots,
  orders,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
  encodeStoredAccountingDocumentSnapshot,
  getAccountingDocumentOrderId,
} from "@/features/accounting/accounting-document-snapshot";
import {
  AccountingDocumentSnapshotStorageError,
  type AccountingPaymentReference,
} from "@/features/accounting/backend/accounting-document-snapshot.repository";
import {
  type AccountingSnapshotKey,
  AccountingSnapshotKeyService,
} from "@/features/accounting/backend/accounting-snapshot-key.service";
import { encryptAccountingSnapshot } from "@/features/accounting/backend/accounting-snapshot-sql";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceMoney,
  workspaceMoneyEquals,
} from "@/features/checkout/workspace-money";
import {
  admitOrderDiscountClaim,
  type ClaimedDiscountApplication,
  type PersistedDiscountApplication,
  persistOrderDiscountApplications,
  redeemAttemptDiscountClaim,
  releaseAttemptDiscountClaim,
  validateOrderDiscountCommitment,
} from "@/features/discounts/backend/order-discount-evidence";
import {
  type DiscountCommitment,
  getDiscountCommitmentPayload,
} from "@/features/discounts/commitment";
import { DiscountClaimError } from "@/features/discounts/errors";
import type { DiscountClaimInstruction } from "@/features/discounts/provider";
import type { Locale } from "@/features/i18n";
import type { OrderId, OrderKind } from "@/features/order";
import { ensureReservationOrder } from "@/features/order/backend/reservation-order";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";
import {
  type PaymentAttempt,
  toPaymentAttempt,
} from "./payment-attempt.repository";

export { validateOrderDiscountCommitment as validateDiscountCommitment } from "@/features/discounts/backend/order-discount-evidence";

export type PaymentLifecycleReference =
  | { readonly type: "paymentAttemptId"; readonly id: PaymentAttemptId }
  | { readonly type: "providerOrderId"; readonly id: NexiOrderId }
  | {
      readonly type: "orderId";
      readonly id: OrderId;
    };

export class PaymentLifecycleStateError extends Data.TaggedError(
  "PaymentLifecycleStateError"
)<{
  readonly operation: string;
  readonly paymentReference: PaymentLifecycleReference;
  readonly message: string;
}> {}

export interface PaymentLifecycleTransition {
  readonly attempt: PaymentAttempt;
  readonly changed: boolean;
  readonly timestamp: Temporal.Instant;
}

export type PaymentSessionEvidence =
  | {
      readonly mode: "reservation_attempt_commitment";
      readonly commitment: DiscountCommitment;
    }
  | { readonly mode: "order_evidence_committed" };

export type PaymentSessionAdmission =
  | {
      readonly status: "paid";
      readonly attempt: PaymentAttempt;
      readonly changed: boolean;
    }
  | { readonly status: "resume"; readonly attempt: PaymentAttempt }
  | { readonly status: "in_progress" }
  | { readonly status: "outstanding_order"; readonly orderId: OrderId }
  | {
      readonly status: "created";
      readonly attempt: PaymentAttempt;
      readonly correlationId: (typeof orders.$inferSelect)["correlationId"];
    };

export type PaymentLifecycleRepositoryError =
  | AccountingDocumentSnapshotStorageError
  | DiscountClaimError
  | EffectDrizzleQueryError
  | PaymentLifecycleStateError
  | SqlError;

export interface IPaymentLifecycleRepository {
  readonly admitPaymentSession: (input: {
    readonly orderId: OrderId;
    readonly providerOrderId?: NexiOrderId;
    readonly payerCustomerId: DotyposCustomerId;
    readonly amount: WorkspaceMoney;
    readonly evidence: PaymentSessionEvidence;
    readonly locale: Locale;
    readonly accountingSnapshot: AccountingDocumentSnapshot;
  }) => Effect.Effect<PaymentSessionAdmission, PaymentLifecycleRepositoryError>;
  readonly createPendingNexiAttempt: (input: {
    readonly orderId: OrderId;
    readonly providerOrderId: NexiOrderId;
    readonly amount: WorkspaceMoney;
    readonly commitment: DiscountCommitment;
    readonly locale: Locale;
    readonly accountingSnapshot: AccountingDocumentSnapshot;
  }) => Effect.Effect<PaymentAttempt, PaymentLifecycleRepositoryError>;
  readonly completeInternalPayment: (input: {
    readonly orderId: OrderId;
    readonly amount: WorkspaceMoney;
    readonly commitment: DiscountCommitment;
    readonly locale: Locale;
    readonly accountingSnapshot: AccountingDocumentSnapshot;
  }) => Effect.Effect<
    PaymentLifecycleTransition,
    PaymentLifecycleRepositoryError
  >;
  readonly attachProviderSession: (input: {
    readonly id: PaymentAttemptId;
    readonly securityToken: string;
    readonly providerRedirectUrl: string;
  }) => Effect.Effect<
    PaymentAttempt,
    EffectDrizzleQueryError | PaymentLifecycleStateError
  >;
  readonly markPaid: (input: {
    readonly id: PaymentAttemptId;
    readonly orderId: OrderId;
    readonly webhookEventId?: NexiWebhookEventId;
    readonly providerOperationId?: NexiOperationId;
    readonly providerStatus?: string;
    readonly paidAt: Temporal.Instant;
  }) => Effect.Effect<
    PaymentLifecycleTransition,
    PaymentLifecycleRepositoryError
  >;
  readonly markTerminal: (input: {
    readonly id: PaymentAttemptId;
    readonly orderId: OrderId;
    readonly state: "failed" | "cancelled" | "expired";
    readonly failureCode: string;
    readonly webhookEventId?: NexiWebhookEventId;
    readonly providerOperationId?: NexiOperationId;
    readonly providerStatus?: string;
  }) => Effect.Effect<
    PaymentLifecycleTransition,
    PaymentLifecycleRepositoryError
  >;
}

export class PaymentLifecycleRepository extends Context.Service<
  PaymentLifecycleRepository,
  IPaymentLifecycleRepository
>()("@deskohub-workspace/checkout/PaymentLifecycleRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const accountingSnapshotKeys = yield* AccountingSnapshotKeyService;

      const admitPaymentSession = Effect.fn(
        "PaymentLifecycleRepository.admitPaymentSession"
      )(function* (input: {
        readonly orderId: OrderId;
        readonly providerOrderId?: NexiOrderId;
        readonly payerCustomerId: DotyposCustomerId;
        readonly amount: WorkspaceMoney;
        readonly evidence: PaymentSessionEvidence;
        readonly locale: Locale;
        readonly accountingSnapshot: AccountingDocumentSnapshot;
      }) {
        const accountingSnapshot =
          yield* validatePaymentSessionAccountingSnapshot(input);
        const commitment =
          input.evidence.mode === "reservation_attempt_commitment"
            ? getDiscountCommitmentPayload(input.evidence.commitment)
            : undefined;
        const claimedApplication = commitment
          ? yield* validatePaymentSessionCommitment(commitment, input.amount)
          : undefined;

        return yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const workspaceReservationId =
                input.evidence.mode === "reservation_attempt_commitment"
                  ? workspaceReservationIdSchema.make(input.orderId)
                  : null;
              const lockedReservation = workspaceReservationId
                ? yield* lockReservationForAdmission({
                    tx,
                    workspaceReservationId,
                  })
                : null;
              const [order] = yield* tx
                .select()
                .from(orders)
                .where(eq(orders.id, input.orderId))
                .limit(1)
                .for("update");
              if (!order) {
                return yield* lifecycleStateError(
                  "admitPaymentSession",
                  { type: "orderId", id: input.orderId },
                  "The order was not found."
                );
              }
              if (order.dotyposCustomerId !== input.payerCustomerId) {
                return yield* lifecycleStateError(
                  "admitPaymentSession",
                  { type: "orderId", id: input.orderId },
                  "The payer does not own the order."
                );
              }

              yield* validatePaymentSessionSnapshotOwner({
                snapshot: accountingSnapshot,
                order,
                reservation: lockedReservation,
                paymentReference: { type: "orderId", id: input.orderId },
              });

              if (
                (order.kind === "reservation") !==
                (input.evidence.mode === "reservation_attempt_commitment")
              ) {
                return yield* lifecycleStateError(
                  "admitPaymentSession",
                  { type: "orderId", id: input.orderId },
                  "The payment evidence mode does not match the order kind."
                );
              }

              const activeAttempt = order.activePaymentAttemptId
                ? yield* loadActiveAttemptForAdmission({
                    tx,
                    orderId: input.orderId,
                    paymentAttemptId: order.activePaymentAttemptId,
                  })
                : null;
              if (order.paymentState === "paid") {
                if (
                  activeAttempt?.state === "paid" &&
                  workspaceMoneyEquals(activeAttempt.amount, input.amount)
                ) {
                  return {
                    status: "paid" as const,
                    attempt: activeAttempt,
                    changed: false,
                  };
                }
                return yield* lifecycleStateError(
                  "admitPaymentSession",
                  { type: "orderId", id: input.orderId },
                  "The paid order has no matching paid attempt."
                );
              }
              if (
                activeAttempt &&
                (activeAttempt.state === "created" ||
                  activeAttempt.state === "pending")
              ) {
                if (!workspaceMoneyEquals(activeAttempt.amount, input.amount)) {
                  return yield* lifecycleStateError(
                    "admitPaymentSession",
                    { type: "paymentAttemptId", id: activeAttempt.id },
                    "The active payment attempt has different money."
                  );
                }
                return activeAttempt.state === "pending" &&
                  activeAttempt.securityToken &&
                  activeAttempt.providerRedirectUrl
                  ? { status: "resume" as const, attempt: activeAttempt }
                  : { status: "in_progress" as const };
              }
              if (
                order.paymentState === "pending" ||
                (activeAttempt &&
                  !["failed", "cancelled", "expired"].includes(
                    activeAttempt.state
                  ))
              ) {
                return yield* lifecycleStateError(
                  "admitPaymentSession",
                  { type: "orderId", id: input.orderId },
                  "The order payment state is inconsistent."
                );
              }
              if (
                !["not_started", "failed", "cancelled", "expired"].includes(
                  order.paymentState
                ) ||
                (order.paymentState !== "not_started" && !activeAttempt) ||
                (activeAttempt && activeAttempt.state !== order.paymentState)
              ) {
                return yield* lifecycleStateError(
                  "admitPaymentSession",
                  { type: "orderId", id: input.orderId },
                  "A new attempt requires a terminal prior attempt."
                );
              }
              if (
                (input.amount.value === 0 && input.providerOrderId) ||
                (input.amount.value > 0 && !input.providerOrderId)
              ) {
                return yield* lifecycleStateError(
                  "admitPaymentSession",
                  { type: "orderId", id: input.orderId },
                  "The provider attempt configuration does not match the amount."
                );
              }

              if (order.kind === "goods") {
                const [oldest] = yield* tx
                  .select({ id: orders.id })
                  .from(orders)
                  .where(
                    and(
                      eq(orders.kind, "goods"),
                      eq(orders.dotyposCustomerId, order.dotyposCustomerId),
                      eq(orders.fulfillmentState, "fulfilled"),
                      inArray(orders.paymentState, [
                        "not_started",
                        "pending",
                        "failed",
                        "cancelled",
                        "expired",
                      ])
                    )
                  )
                  .orderBy(asc(orders.createdAt), asc(orders.id))
                  .limit(1)
                  .for("update");
                if (oldest && oldest.id !== input.orderId) {
                  return {
                    status: "outstanding_order" as const,
                    orderId: oldest.id,
                  };
                }
              }

              const reservation = workspaceReservationId
                ? yield* validatePayableReservationForAdmission({
                    reservation: lockedReservation,
                    order,
                  })
                : null;

              const now = Temporal.Now.instant();
              const provider = input.amount.value === 0 ? "internal" : "nexi";
              const state = input.amount.value === 0 ? "paid" : "created";
              const [attemptRow] = yield* tx
                .insert(paymentAttempts)
                .values({
                  id: postgresUuidV7,
                  orderId: input.orderId,
                  workspaceReservationId,
                  provider,
                  providerOrderId: input.providerOrderId ?? null,
                  state,
                  amountValue: input.amount.value,
                  amountExponent: input.amount.exponent,
                  currency: input.amount.currency,
                  createdAt: now,
                  updatedAt: now,
                })
                .returning();
              if (!attemptRow) {
                return yield* Effect.die(
                  "Payment session attempt insert returned no row."
                );
              }

              const accountingSnapshotKey =
                yield* accountingSnapshotKeys.getActive.pipe(
                  Effect.mapError(
                    () =>
                      new AccountingDocumentSnapshotStorageError({
                        operation: "encrypt",
                        paymentReference: {
                          type: "paymentAttemptId",
                          id: attemptRow.id,
                        },
                        message:
                          "Accounting snapshot encryption key is unavailable.",
                      })
                  )
                );

              yield* persistAccountingDocumentSnapshot({
                tx,
                orderId: input.orderId,
                paymentAttemptId: attemptRow.id,
                workspaceReservationId,
                snapshot: accountingSnapshot,
                key: accountingSnapshotKey,
              });

              const nextPaymentState =
                input.amount.value === 0 ? "paid" : "pending";
              const [updatedOrder] = yield* tx
                .update(orders)
                .set({
                  activePaymentAttemptId: attemptRow.id,
                  paymentState: nextPaymentState,
                  paidAt: input.amount.value === 0 ? now : null,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(orders.id, input.orderId),
                    inArray(orders.paymentState, [
                      "not_started",
                      "failed",
                      "cancelled",
                      "expired",
                    ])
                  )
                )
                .returning({ id: orders.id });
              if (!updatedOrder) {
                return yield* lifecycleStateError(
                  "admitPaymentSession",
                  { type: "paymentAttemptId", id: attemptRow.id },
                  "The payment attempt could not be linked to the order."
                );
              }

              if (reservation && workspaceReservationId) {
                const [updatedReservation] = yield* tx
                  .update(workspaceReservations)
                  .set({
                    activePaymentAttemptId: attemptRow.id,
                    paymentState: nextPaymentState,
                    paidAt: input.amount.value === 0 ? now : null,
                    failureCode: null,
                    updatedAt: now,
                  })
                  .where(
                    and(
                      eq(workspaceReservations.id, workspaceReservationId),
                      eq(workspaceReservations.reservationState, "held"),
                      inArray(workspaceReservations.paymentState, [
                        "not_started",
                        "failed",
                        "cancelled",
                        "expired",
                      ])
                    )
                  )
                  .returning({ id: workspaceReservations.id });
                if (!updatedReservation) {
                  return yield* lifecycleStateError(
                    "admitPaymentSession",
                    { type: "paymentAttemptId", id: attemptRow.id },
                    "The payment attempt could not be linked to the reservation."
                  );
                }
              }

              if (
                commitment &&
                reservation &&
                workspaceReservationId &&
                input.evidence.mode === "reservation_attempt_commitment"
              ) {
                const applicationRows = yield* persistOrderDiscountApplications(
                  {
                    tx,
                    commitment,
                    owner: {
                      kind: "reservation_attempt",
                      orderId: input.orderId,
                      paymentAttemptId: attemptRow.id,
                      workspaceReservationId,
                    },
                  }
                );
                const claimedAt = yield* reserveCommittedCodeClaim({
                  tx,
                  claimedApplication,
                  applicationRows,
                  orderId: input.orderId,
                  paymentAttemptId: attemptRow.id,
                  locale: input.locale,
                  reservationCustomerId: reservation.dotyposCustomerId,
                  reservationExpiresAt: reservation.reservationHoldExpiresAt!,
                });
                if (claimedAt && input.amount.value === 0) {
                  yield* redeemAttemptDiscountClaim({
                    tx,
                    orderId: input.orderId,
                    paymentAttemptId: attemptRow.id,
                    redeemedAt: claimedAt,
                  });
                }
              }

              return input.amount.value === 0
                ? {
                    status: "paid" as const,
                    attempt: toPaymentAttempt(attemptRow),
                    changed: true,
                  }
                : {
                    status: "created" as const,
                    attempt: toPaymentAttempt(attemptRow),
                    correlationId: order.correlationId,
                  };
            })
          )
          .pipe(
            Effect.catchIf(isActiveClaimUniqueViolation, (cause) =>
              Effect.fail(
                new DiscountClaimError({
                  operation: "reserve",
                  reason: "claim_conflict",
                  message:
                    "The discount code was claimed by another payment attempt.",
                  cause,
                })
              )
            )
          );
      });

      const createPendingNexiAttempt = Effect.fn(
        "PaymentLifecycleRepository.createPendingNexiAttempt"
      )(function* (input: {
        readonly orderId: OrderId;
        readonly providerOrderId: NexiOrderId;
        readonly amount: WorkspaceMoney;
        readonly commitment: DiscountCommitment;
        readonly locale: Locale;
        readonly accountingSnapshot: AccountingDocumentSnapshot;
      }) {
        const workspaceReservationId = workspaceReservationIdSchema.make(
          input.orderId
        );
        const accountingSnapshot =
          yield* validateAccountingDocumentSnapshotForAttempt({
            snapshot: input.accountingSnapshot,
            workspaceReservationId,
            amount: input.amount,
            locale: input.locale,
            paymentReference: {
              type: "providerOrderId",
              id: input.providerOrderId,
            },
          });
        const accountingSnapshotKey =
          yield* accountingSnapshotKeys.getActive.pipe(
            Effect.mapError(
              () =>
                new AccountingDocumentSnapshotStorageError({
                  operation: "encrypt",
                  paymentReference: {
                    type: "providerOrderId",
                    id: input.providerOrderId,
                  },
                  message: "Accounting snapshot encryption key is unavailable.",
                })
            )
          );
        const commitment = getDiscountCommitmentPayload(input.commitment);
        const claimedApplication =
          yield* validateOrderDiscountCommitment(commitment);

        return yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const [reservation] = yield* tx
                .select()
                .from(workspaceReservations)
                .where(
                  and(
                    eq(workspaceReservations.id, workspaceReservationId),
                    eq(workspaceReservations.reservationState, "held"),
                    inArray(workspaceReservations.paymentState, [
                      "not_started",
                      "failed",
                      "cancelled",
                      "expired",
                    ])
                  )
                )
                .limit(1)
                .for("update");

              const now = Temporal.Now.instant();
              if (
                !reservation?.reservationHoldExpiresAt ||
                Temporal.Instant.compare(
                  reservation.reservationHoldExpiresAt,
                  now
                ) <= 0
              ) {
                return yield* new PaymentLifecycleStateError({
                  operation:
                    "PaymentLifecycleRepository.createPendingNexiAttempt",
                  paymentReference: {
                    type: "providerOrderId",
                    id: input.providerOrderId,
                  },
                  message:
                    "Payment attempts can only be created for a current held reservation.",
                });
              }
              yield* ensureReservationOrder({ tx, reservation });

              yield* validateAccountingDocumentSnapshotProviderIdentity({
                snapshot: accountingSnapshot,
                paymentReference: {
                  type: "providerOrderId",
                  id: input.providerOrderId,
                },
                dotyposCustomerId: reservation.dotyposCustomerId,
                dotyposReservationId: reservation.dotyposReservationId,
              });

              const [attemptRow] = yield* tx
                .insert(paymentAttempts)
                .values({
                  id: postgresUuidV7,
                  orderId: input.orderId,
                  workspaceReservationId,
                  provider: "nexi",
                  providerOrderId: input.providerOrderId,
                  state: "created",
                  amountValue: input.amount.value,
                  amountExponent: input.amount.exponent,
                  currency: input.amount.currency,
                })
                .returning();

              if (!attemptRow) {
                return yield* Effect.die(
                  "Payment attempt insert returned no row."
                );
              }

              yield* persistAccountingDocumentSnapshot({
                tx,
                orderId: input.orderId,
                paymentAttemptId: attemptRow.id,
                workspaceReservationId,
                snapshot: accountingSnapshot,
                key: accountingSnapshotKey,
              });

              const [linkedOrder] = yield* tx
                .update(orders)
                .set({
                  activePaymentAttemptId: attemptRow.id,
                  paymentState: "pending",
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(orders.id, input.orderId),
                    eq(orders.kind, "reservation"),
                    inArray(orders.paymentState, [
                      "not_started",
                      "failed",
                      "cancelled",
                      "expired",
                    ])
                  )
                )
                .returning({ id: orders.id });

              const [linkedReservation] = yield* tx
                .update(workspaceReservations)
                .set({
                  activePaymentAttemptId: attemptRow.id,
                  paymentState: "pending",
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(workspaceReservations.id, workspaceReservationId),
                    eq(workspaceReservations.reservationState, "held"),
                    inArray(workspaceReservations.paymentState, [
                      "not_started",
                      "failed",
                      "cancelled",
                      "expired",
                    ])
                  )
                )
                .returning({ id: workspaceReservations.id });

              if (!(linkedOrder && linkedReservation)) {
                return yield* new PaymentLifecycleStateError({
                  operation:
                    "PaymentLifecycleRepository.createPendingNexiAttempt",
                  paymentReference: {
                    type: "paymentAttemptId",
                    id: attemptRow.id,
                  },
                  message:
                    "Payment attempts can only be linked to held unpaid reservations.",
                });
              }

              const applicationRows = yield* persistOrderDiscountApplications({
                tx,
                commitment,
                owner: {
                  kind: "reservation_attempt",
                  orderId: input.orderId,
                  paymentAttemptId: attemptRow.id,
                  workspaceReservationId,
                },
              });
              yield* reserveCommittedCodeClaim({
                tx,
                claimedApplication,
                applicationRows,
                orderId: input.orderId,
                paymentAttemptId: attemptRow.id,
                locale: input.locale,
                reservationCustomerId: reservation.dotyposCustomerId,
                reservationExpiresAt: reservation.reservationHoldExpiresAt,
              });

              return toPaymentAttempt(attemptRow);
            })
          )
          .pipe(
            Effect.catchIf(isActiveClaimUniqueViolation, (cause) =>
              Effect.fail(
                new DiscountClaimError({
                  operation: "reserve",
                  reason: "claim_conflict",
                  message:
                    "The discount code was claimed by another payment attempt.",
                  cause,
                })
              )
            )
          );
      });

      const completeInternalPayment = Effect.fn(
        "PaymentLifecycleRepository.completeInternalPayment"
      )(function* (input: {
        readonly orderId: OrderId;
        readonly amount: WorkspaceMoney;
        readonly commitment: DiscountCommitment;
        readonly locale: Locale;
        readonly accountingSnapshot: AccountingDocumentSnapshot;
      }) {
        const workspaceReservationId = workspaceReservationIdSchema.make(
          input.orderId
        );
        const accountingSnapshot =
          yield* validateAccountingDocumentSnapshotForAttempt({
            snapshot: input.accountingSnapshot,
            workspaceReservationId,
            amount: input.amount,
            locale: input.locale,
            paymentReference: {
              type: "workspaceReservationId",
              id: workspaceReservationId,
            },
          });
        const commitment = getDiscountCommitmentPayload(input.commitment);
        const claimedApplication = yield* validateInternalPaymentCommitment(
          commitment,
          input.amount
        );

        if (input.amount.value !== 0) {
          return yield* lifecycleStateError(
            "completeInternalPayment",
            {
              type: "orderId",
              id: input.orderId,
            },
            "Internal payments require an exactly zero payable amount."
          );
        }

        return yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const [reservation] = yield* tx
                .select()
                .from(workspaceReservations)
                .where(eq(workspaceReservations.id, workspaceReservationId))
                .limit(1)
                .for("update");

              if (!reservation) {
                return yield* lifecycleStateError(
                  "completeInternalPayment",
                  { type: "orderId", id: input.orderId },
                  "Internal payments require a reservation-backed order."
                );
              }
              const order = yield* ensureReservationOrder({ tx, reservation });

              const paidAt = Temporal.Now.instant();

              if (
                reservation?.paymentState === "paid" &&
                reservation.activePaymentAttemptId
              ) {
                yield* lockOrderForPaymentTransition({
                  tx,
                  orderId: input.orderId,
                  paymentAttemptId: reservation.activePaymentAttemptId,
                  operation: "completeInternalPayment",
                });
                const [existingAttempt] = yield* tx
                  .select()
                  .from(paymentAttempts)
                  .where(
                    and(
                      eq(
                        paymentAttempts.id,
                        reservation.activePaymentAttemptId
                      ),
                      eq(paymentAttempts.orderId, input.orderId),
                      eq(paymentAttempts.provider, "internal"),
                      eq(paymentAttempts.state, "paid")
                    )
                  )
                  .limit(1);

                if (
                  existingAttempt &&
                  workspaceMoneyEquals(
                    toPaymentAttempt(existingAttempt).amount,
                    input.amount
                  )
                ) {
                  return {
                    attempt: toPaymentAttempt(existingAttempt),
                    changed: false,
                    timestamp: reservation.paidAt ?? existingAttempt.updatedAt,
                  };
                }
              }

              if (
                order.dotyposCustomerId !== reservation.dotyposCustomerId ||
                reservation.reservationState !== "held" ||
                !reservation.reservationHoldExpiresAt ||
                Temporal.Instant.compare(
                  reservation.reservationHoldExpiresAt,
                  paidAt
                ) <= 0 ||
                !["not_started", "failed", "cancelled", "expired"].includes(
                  reservation.paymentState
                )
              ) {
                return yield* lifecycleStateError(
                  "completeInternalPayment",
                  {
                    type: "orderId",
                    id: input.orderId,
                  },
                  "Internal payments can only complete a current held unpaid reservation."
                );
              }

              yield* validateAccountingDocumentSnapshotProviderIdentity({
                snapshot: accountingSnapshot,
                paymentReference: {
                  type: "workspaceReservationId",
                  id: workspaceReservationId,
                },
                dotyposCustomerId: reservation.dotyposCustomerId,
                dotyposReservationId: reservation.dotyposReservationId,
              });

              const accountingSnapshotKey =
                yield* accountingSnapshotKeys.getActive.pipe(
                  Effect.mapError(
                    () =>
                      new AccountingDocumentSnapshotStorageError({
                        operation: "encrypt",
                        paymentReference: {
                          type: "workspaceReservationId",
                          id: workspaceReservationId,
                        },
                        message:
                          "Accounting snapshot encryption key is unavailable.",
                      })
                  )
                );

              const [attemptRow] = yield* tx
                .insert(paymentAttempts)
                .values({
                  id: postgresUuidV7,
                  orderId: input.orderId,
                  workspaceReservationId,
                  provider: "internal",
                  providerOrderId: null,
                  state: "paid",
                  amountValue: input.amount.value,
                  amountExponent: input.amount.exponent,
                  currency: input.amount.currency,
                  createdAt: paidAt,
                  updatedAt: paidAt,
                })
                .returning();

              if (!attemptRow) {
                return yield* Effect.die(
                  "Internal payment attempt insert returned no row."
                );
              }

              yield* persistAccountingDocumentSnapshot({
                tx,
                orderId: input.orderId,
                paymentAttemptId: attemptRow.id,
                workspaceReservationId,
                snapshot: accountingSnapshot,
                key: accountingSnapshotKey,
              });

              const [completedOrder] = yield* tx
                .update(orders)
                .set({
                  activePaymentAttemptId: attemptRow.id,
                  paymentState: "paid",
                  paidAt,
                  updatedAt: paidAt,
                })
                .where(
                  and(
                    eq(orders.id, input.orderId),
                    eq(orders.kind, "reservation"),
                    inArray(orders.paymentState, [
                      "not_started",
                      "failed",
                      "cancelled",
                      "expired",
                    ])
                  )
                )
                .returning({ id: orders.id });

              const [completedReservation] = yield* tx
                .update(workspaceReservations)
                .set({
                  activePaymentAttemptId: attemptRow.id,
                  paymentState: "paid",
                  paidAt,
                  failureCode: null,
                  updatedAt: paidAt,
                })
                .where(
                  and(
                    eq(workspaceReservations.id, workspaceReservationId),
                    eq(workspaceReservations.reservationState, "held"),
                    inArray(workspaceReservations.paymentState, [
                      "not_started",
                      "failed",
                      "cancelled",
                      "expired",
                    ])
                  )
                )
                .returning({ id: workspaceReservations.id });

              if (!(completedOrder && completedReservation)) {
                return yield* lifecycleStateError(
                  "completeInternalPayment",
                  { type: "paymentAttemptId", id: attemptRow.id },
                  "Internal payment could not atomically complete the held reservation."
                );
              }

              const applicationRows = yield* persistOrderDiscountApplications({
                tx,
                commitment,
                owner: {
                  kind: "reservation_attempt",
                  orderId: input.orderId,
                  paymentAttemptId: attemptRow.id,
                  workspaceReservationId,
                },
              });
              const claimedAt = yield* reserveCommittedCodeClaim({
                tx,
                claimedApplication,
                applicationRows,
                orderId: input.orderId,
                paymentAttemptId: attemptRow.id,
                locale: input.locale,
                reservationCustomerId: reservation.dotyposCustomerId,
                reservationExpiresAt: reservation.reservationHoldExpiresAt,
              });
              if (claimedAt) {
                yield* redeemAttemptDiscountClaim({
                  tx,
                  orderId: input.orderId,
                  paymentAttemptId: attemptRow.id,
                  redeemedAt: claimedAt,
                });
              }

              return {
                attempt: toPaymentAttempt(attemptRow),
                changed: true,
                timestamp: paidAt,
              };
            })
          )
          .pipe(
            Effect.catchIf(isActiveClaimUniqueViolation, (cause) =>
              Effect.fail(
                new DiscountClaimError({
                  operation: "reserve",
                  reason: "claim_conflict",
                  message:
                    "The discount code was claimed by another payment attempt.",
                  cause,
                })
              )
            )
          );
      });

      const attachProviderSession = Effect.fn(
        "PaymentLifecycleRepository.attachProviderSession"
      )(function* (input: {
        readonly id: PaymentAttemptId;
        readonly securityToken: string;
        readonly providerRedirectUrl: string;
      }) {
        const providerOrderCreatedAt = Temporal.Now.instant();
        const [attempt] = yield* db
          .update(paymentAttempts)
          .set({
            state: "pending",
            securityToken: sensitiveDatabaseParameter(input.securityToken),
            providerRedirectUrl: sensitiveDatabaseParameter(
              input.providerRedirectUrl
            ),
            providerOrderCreatedAt,
            updatedAt: providerOrderCreatedAt,
          })
          .where(
            and(
              eq(paymentAttempts.id, input.id),
              eq(paymentAttempts.state, "created")
            )
          )
          .returning();

        if (!attempt) {
          return yield* new PaymentLifecycleStateError({
            operation: "PaymentLifecycleRepository.attachProviderSession",
            paymentReference: { type: "paymentAttemptId", id: input.id },
            message:
              "Only created payment attempts can attach a provider session.",
          });
        }

        return toPaymentAttempt(attempt);
      });

      const markPaid = Effect.fn("PaymentLifecycleRepository.markPaid")(
        function* (input: {
          readonly id: PaymentAttemptId;
          readonly orderId: OrderId;
          readonly webhookEventId?: NexiWebhookEventId;
          readonly providerOperationId?: NexiOperationId;
          readonly providerStatus?: string;
          readonly paidAt: Temporal.Instant;
        }) {
          return yield* db.transaction((tx) =>
            Effect.gen(function* () {
              const lockedOrder = yield* lockOrderForPaymentTransition({
                tx,
                orderId: input.orderId,
                paymentAttemptId: input.id,
                operation: "markPaid",
              });
              const payableAttemptStates = Match.value(lockedOrder.kind).pipe(
                Match.when(
                  "reservation",
                  () => ["created", "pending", "paid"] as const
                ),
                Match.when(
                  "goods",
                  () =>
                    [
                      "created",
                      "pending",
                      "paid",
                      "failed",
                      "cancelled",
                      "expired",
                    ] as const
                ),
                Match.exhaustive
              );
              const isSupersededGoodsAttempt =
                lockedOrder.kind === "goods" &&
                lockedOrder.activePaymentAttemptId !== input.id;
              const requiresRefund =
                isSupersededGoodsAttempt && lockedOrder.paymentState === "paid";
              const replacesActiveAttempt =
                isSupersededGoodsAttempt && lockedOrder.paymentState !== "paid";
              if (
                replacesActiveAttempt &&
                !["failed", "cancelled", "expired", "paid"].includes(
                  (yield* tx
                    .select({ state: paymentAttempts.state })
                    .from(paymentAttempts)
                    .where(
                      and(
                        eq(paymentAttempts.id, input.id),
                        eq(paymentAttempts.orderId, input.orderId)
                      )
                    )
                    .limit(1)
                    .for("update"))[0]?.state ?? ""
                )
              ) {
                return yield* lifecycleStateError(
                  "markPaid",
                  { type: "paymentAttemptId", id: input.id },
                  "Only a terminal superseded goods attempt can replace the active attempt."
                );
              }
              const [attempt] = yield* tx
                .update(paymentAttempts)
                .set({
                  state: "paid",
                  ...(requiresRefund && { refundState: "required" }),
                  lastWebhookEventId: input.webhookEventId,
                  lastProviderOperationId: input.providerOperationId,
                  lastProviderStatus: input.providerStatus,
                  failureCode: null,
                  updatedAt: input.paidAt,
                })
                .where(
                  and(
                    eq(paymentAttempts.id, input.id),
                    eq(paymentAttempts.orderId, input.orderId),
                    inArray(paymentAttempts.state, payableAttemptStates)
                  )
                )
                .returning();

              if (!attempt) {
                return yield* lifecycleStateError(
                  "markPaid",
                  { type: "paymentAttemptId", id: input.id },
                  "Only an eligible provider attempt can mark an order paid."
                );
              }

              if (requiresRefund) {
                return {
                  attempt: toPaymentAttempt(attempt),
                  changed: false,
                  timestamp: lockedOrder.paidAt ?? input.paidAt,
                };
              }

              if (replacesActiveAttempt) {
                if (!lockedOrder.activePaymentAttemptId) {
                  return yield* lifecycleStateError(
                    "markPaid",
                    { type: "paymentAttemptId", id: input.id },
                    "A superseded goods payment has no active replacement attempt."
                  );
                }
                yield* tx
                  .update(paymentAttempts)
                  .set({
                    state: "expired",
                    failureCode: "superseded_by_paid_attempt",
                    updatedAt: input.paidAt,
                  })
                  .where(
                    and(
                      eq(
                        paymentAttempts.id,
                        lockedOrder.activePaymentAttemptId
                      ),
                      eq(paymentAttempts.orderId, input.orderId),
                      inArray(paymentAttempts.state, ["created", "pending"])
                    )
                  );
              }

              const [changedOrder] = yield* tx
                .update(orders)
                .set({
                  ...(replacesActiveAttempt && {
                    activePaymentAttemptId: input.id,
                  }),
                  paymentState: "paid",
                  paidAt: input.paidAt,
                  updatedAt: input.paidAt,
                })
                .where(
                  and(
                    eq(orders.id, input.orderId),
                    Match.value(lockedOrder.kind).pipe(
                      Match.when("reservation", () =>
                        eq(orders.paymentState, "pending")
                      ),
                      Match.when("goods", () =>
                        inArray(orders.paymentState, [
                          "pending",
                          "failed",
                          "cancelled",
                          "expired",
                        ])
                      ),
                      Match.exhaustive
                    ),
                    eq(
                      orders.activePaymentAttemptId,
                      replacesActiveAttempt
                        ? lockedOrder.activePaymentAttemptId!
                        : input.id
                    )
                  )
                )
                .returning({ kind: orders.kind, paidAt: orders.paidAt });

              if (changedOrder) {
                yield* mirrorPaidReservation({
                  tx,
                  kind: changedOrder.kind,
                  orderId: input.orderId,
                  paymentAttemptId: input.id,
                  paidAt: input.paidAt,
                  requireHeld: true,
                });
                yield* redeemAttemptDiscountClaim({
                  tx,
                  orderId: input.orderId,
                  paymentAttemptId: input.id,
                  redeemedAt: input.paidAt,
                });
                return {
                  attempt: toPaymentAttempt(attempt),
                  changed: true,
                  timestamp: changedOrder.paidAt ?? input.paidAt,
                };
              }

              const [consistent] = yield* tx
                .select({ kind: orders.kind, paidAt: orders.paidAt })
                .from(orders)
                .where(
                  and(
                    eq(orders.id, input.orderId),
                    eq(orders.paymentState, "paid"),
                    eq(orders.activePaymentAttemptId, input.id)
                  )
                )
                .limit(1);

              if (!consistent) {
                return yield* lifecycleStateError(
                  "markPaid",
                  { type: "paymentAttemptId", id: input.id },
                  "Only the active pending attempt can mark an order paid."
                );
              }

              yield* mirrorPaidReservation({
                tx,
                kind: consistent.kind,
                orderId: input.orderId,
                paymentAttemptId: input.id,
                paidAt: consistent.paidAt ?? input.paidAt,
              });
              yield* redeemAttemptDiscountClaim({
                tx,
                orderId: input.orderId,
                paymentAttemptId: input.id,
                redeemedAt: consistent.paidAt ?? input.paidAt,
              });
              return {
                attempt: toPaymentAttempt(attempt),
                changed: false,
                timestamp: consistent.paidAt ?? input.paidAt,
              };
            })
          );
        }
      );

      const markTerminal = Effect.fn("PaymentLifecycleRepository.markTerminal")(
        function* (input: {
          readonly id: PaymentAttemptId;
          readonly orderId: OrderId;
          readonly state: "failed" | "cancelled" | "expired";
          readonly failureCode: string;
          readonly webhookEventId?: NexiWebhookEventId;
          readonly providerOperationId?: NexiOperationId;
          readonly providerStatus?: string;
        }) {
          const terminalAt = Temporal.Now.instant();

          return yield* db.transaction((tx) =>
            Effect.gen(function* () {
              const lockedOrder = yield* lockOrderForPaymentTransition({
                tx,
                orderId: input.orderId,
                paymentAttemptId: input.id,
                operation: "markTerminal",
              });
              const isSupersededPaidGoodsAttempt =
                lockedOrder.kind === "goods" &&
                lockedOrder.paymentState === "paid" &&
                lockedOrder.activePaymentAttemptId !== input.id;
              const [attempt] = yield* tx
                .update(paymentAttempts)
                .set({
                  state: input.state,
                  failureCode: input.failureCode,
                  lastWebhookEventId: input.webhookEventId,
                  lastProviderOperationId: input.providerOperationId,
                  lastProviderStatus: input.providerStatus,
                  updatedAt: terminalAt,
                })
                .where(
                  and(
                    eq(paymentAttempts.id, input.id),
                    eq(paymentAttempts.orderId, input.orderId),
                    inArray(
                      paymentAttempts.state,
                      isSupersededPaidGoodsAttempt
                        ? [
                            "created",
                            "pending",
                            "failed",
                            "cancelled",
                            "expired",
                          ]
                        : ["created", "pending", input.state]
                    )
                  )
                )
                .returning();

              if (!attempt) {
                return yield* lifecycleStateError(
                  "markTerminal",
                  { type: "paymentAttemptId", id: input.id },
                  "Only a non-terminal or matching terminal attempt can mark an order terminal."
                );
              }

              if (isSupersededPaidGoodsAttempt) {
                return {
                  attempt: toPaymentAttempt(attempt),
                  changed: false,
                  timestamp: attempt.updatedAt,
                };
              }

              const [changedOrder] = yield* tx
                .update(orders)
                .set({
                  paymentState: input.state,
                  updatedAt: terminalAt,
                })
                .where(
                  and(
                    eq(orders.id, input.orderId),
                    eq(orders.paymentState, "pending"),
                    eq(orders.activePaymentAttemptId, input.id)
                  )
                )
                .returning({ kind: orders.kind, updatedAt: orders.updatedAt });

              if (changedOrder) {
                yield* mirrorTerminalReservation({
                  tx,
                  kind: changedOrder.kind,
                  orderId: input.orderId,
                  paymentAttemptId: input.id,
                  state: input.state,
                  failureCode: input.failureCode,
                  terminalAt,
                  requireHeld: true,
                });
                yield* releaseAttemptDiscountClaim({
                  tx,
                  orderId: input.orderId,
                  paymentAttemptId: input.id,
                  releasedAt: terminalAt,
                  releaseReason: input.failureCode,
                });
                return {
                  attempt: toPaymentAttempt(attempt),
                  changed: true,
                  timestamp: changedOrder.updatedAt,
                };
              }

              const [consistent] = yield* tx
                .select({ kind: orders.kind, updatedAt: orders.updatedAt })
                .from(orders)
                .where(
                  and(
                    eq(orders.id, input.orderId),
                    eq(orders.paymentState, input.state),
                    eq(orders.activePaymentAttemptId, input.id)
                  )
                )
                .limit(1);

              if (!consistent) {
                return yield* lifecycleStateError(
                  "markTerminal",
                  { type: "paymentAttemptId", id: input.id },
                  "Only the active pending attempt can mark an order terminal."
                );
              }

              yield* mirrorTerminalReservation({
                tx,
                kind: consistent.kind,
                orderId: input.orderId,
                paymentAttemptId: input.id,
                state: input.state,
                failureCode: input.failureCode,
                terminalAt: consistent.updatedAt,
              });
              yield* releaseAttemptDiscountClaim({
                tx,
                orderId: input.orderId,
                paymentAttemptId: input.id,
                releasedAt: consistent.updatedAt,
                releaseReason: input.failureCode,
              });
              return {
                attempt: toPaymentAttempt(attempt),
                changed: false,
                timestamp: consistent.updatedAt,
              };
            })
          );
        }
      );

      return {
        admitPaymentSession,
        createPendingNexiAttempt,
        completeInternalPayment,
        attachProviderSession,
        markPaid,
        markTerminal,
      } satisfies IPaymentLifecycleRepository;
    }).pipe(Effect.provide(AccountingSnapshotKeyService.Default))
  );
}

const lockOrderForPaymentTransition = Effect.fn(
  "PaymentLifecycleRepository.lockOrderForPaymentTransition"
)(function* (input: {
  readonly tx: TransactionClient;
  readonly orderId: OrderId;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly operation: "completeInternalPayment" | "markPaid" | "markTerminal";
}) {
  const [association] = yield* input.tx
    .select({
      orderId: paymentAttempts.orderId,
      workspaceReservationId: paymentAttempts.workspaceReservationId,
    })
    .from(paymentAttempts)
    .where(
      and(
        eq(paymentAttempts.id, input.paymentAttemptId),
        or(
          eq(paymentAttempts.orderId, input.orderId),
          and(
            isNull(paymentAttempts.orderId),
            sql`${paymentAttempts.workspaceReservationId} = ${input.orderId}`
          )
        )
      )
    )
    .limit(1);

  if (!association) {
    return yield* lifecycleStateError(
      input.operation,
      { type: "paymentAttemptId", id: input.paymentAttemptId },
      "The payment attempt is not linked to the requested order."
    );
  }

  if (association.workspaceReservationId) {
    const [reservation] = yield* input.tx
      .select()
      .from(workspaceReservations)
      .where(
        and(
          eq(workspaceReservations.id, association.workspaceReservationId),
          sql`${workspaceReservations.id} = ${input.orderId}`
        )
      )
      .limit(1)
      .for("update");
    if (!reservation) {
      return yield* lifecycleStateError(
        input.operation,
        { type: "paymentAttemptId", id: input.paymentAttemptId },
        "The reservation payment attempt has no matching reservation."
      );
    }
    const order = yield* ensureReservationOrder({
      tx: input.tx,
      reservation,
    });
    if (!association.orderId) {
      const [repaired] = yield* input.tx
        .update(paymentAttempts)
        .set({ orderId: input.orderId })
        .where(
          and(
            eq(paymentAttempts.id, input.paymentAttemptId),
            isNull(paymentAttempts.orderId),
            eq(
              paymentAttempts.workspaceReservationId,
              association.workspaceReservationId
            )
          )
        )
        .returning({ id: paymentAttempts.id });
      if (!repaired) {
        return yield* lifecycleStateError(
          input.operation,
          { type: "paymentAttemptId", id: input.paymentAttemptId },
          "The legacy payment attempt order link could not be repaired."
        );
      }
    }
    return order;
  }

  const [order] = yield* input.tx
    .select()
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1)
    .for("update");
  if (order) return order;

  return yield* lifecycleStateError(
    input.operation,
    { type: "paymentAttemptId", id: input.paymentAttemptId },
    "The payment attempt order was not found."
  );
});

const mirrorPaidReservation = Effect.fn(
  "PaymentLifecycleRepository.mirrorPaidReservation"
)(function* (input: {
  readonly tx: TransactionClient;
  readonly kind: OrderKind;
  readonly orderId: OrderId;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly paidAt: Temporal.Instant;
  readonly requireHeld?: boolean;
}) {
  yield* Match.value(input.kind).pipe(
    Match.when("goods", () => Effect.void),
    Match.when("reservation", () => {
      const workspaceReservationId = workspaceReservationIdSchema.make(
        input.orderId
      );
      return Effect.gen(function* () {
        const [reservation] = yield* input.tx
          .update(workspaceReservations)
          .set({
            paymentState: "paid",
            paidAt: input.paidAt,
            failureCode: null,
            updatedAt: input.paidAt,
          })
          .where(
            and(
              eq(workspaceReservations.id, workspaceReservationId),
              eq(
                workspaceReservations.activePaymentAttemptId,
                input.paymentAttemptId
              ),
              inArray(workspaceReservations.paymentState, ["pending", "paid"]),
              input.requireHeld
                ? eq(workspaceReservations.reservationState, "held")
                : sql`true`
            )
          )
          .returning({ id: workspaceReservations.id });
        if (!reservation) {
          return yield* lifecycleStateError(
            "mirrorPaidReservation",
            { type: "paymentAttemptId", id: input.paymentAttemptId },
            "The reservation payment mirror could not be repaired."
          );
        }
      });
    }),
    Match.exhaustive
  );
});

const mirrorTerminalReservation = Effect.fn(
  "PaymentLifecycleRepository.mirrorTerminalReservation"
)(function* (input: {
  readonly tx: TransactionClient;
  readonly kind: OrderKind;
  readonly orderId: OrderId;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly state: "failed" | "cancelled" | "expired";
  readonly failureCode: string;
  readonly terminalAt: Temporal.Instant;
  readonly requireHeld?: boolean;
}) {
  yield* Match.value(input.kind).pipe(
    Match.when("goods", () => Effect.void),
    Match.when("reservation", () => {
      const workspaceReservationId = workspaceReservationIdSchema.make(
        input.orderId
      );
      return Effect.gen(function* () {
        const [reservation] = yield* input.tx
          .update(workspaceReservations)
          .set({
            paymentState: input.state,
            failureCode: input.failureCode,
            updatedAt: input.terminalAt,
          })
          .where(
            and(
              eq(workspaceReservations.id, workspaceReservationId),
              eq(
                workspaceReservations.activePaymentAttemptId,
                input.paymentAttemptId
              ),
              inArray(workspaceReservations.paymentState, [
                "pending",
                input.state,
              ]),
              input.requireHeld
                ? eq(workspaceReservations.reservationState, "held")
                : sql`true`
            )
          )
          .returning({ id: workspaceReservations.id });
        if (!reservation) {
          return yield* lifecycleStateError(
            "mirrorTerminalReservation",
            { type: "paymentAttemptId", id: input.paymentAttemptId },
            "The reservation terminal-payment mirror could not be repaired."
          );
        }
      });
    }),
    Match.exhaustive
  );
});

type CommitmentPayload = ReturnType<typeof getDiscountCommitmentPayload>;

export const validateInternalPaymentCommitment = Effect.fn(
  "PaymentLifecycle.validateInternalPaymentCommitment"
)(function* (commitment: CommitmentPayload, amount: WorkspaceMoney) {
  const claimedApplication = yield* validateOrderDiscountCommitment(commitment);
  const finalSubtotal =
    commitment.applications.at(-1)?.application.subtotalAfter;

  if (!finalSubtotal || !workspaceMoneyEquals(finalSubtotal, amount)) {
    return yield* new DiscountClaimError({
      operation: "reserve",
      reason: "money_mismatch",
      message:
        "An internal payment commitment must reduce the discountable subtotal to its payable amount.",
    });
  }

  return claimedApplication;
});

const validatePaymentSessionCommitment = (
  commitment: CommitmentPayload,
  amount: WorkspaceMoney
) =>
  amount.value === 0
    ? validateInternalPaymentCommitment(commitment, amount)
    : validateOrderDiscountCommitment(commitment);

const lifecycleStateError = (
  operation: string,
  paymentReference: PaymentLifecycleReference,
  message: string
) =>
  new PaymentLifecycleStateError({
    operation: `PaymentLifecycleRepository.${operation}`,
    paymentReference,
    message,
  });

const claimError = (
  operation: "reserve" | "redeem" | "release",
  reason: ConstructorParameters<typeof DiscountClaimError>[0]["reason"],
  message: string,
  claim?: DiscountClaimInstruction
) =>
  new DiscountClaimError({
    operation,
    reason,
    message,
    codeId: getPromotionClaimId(claim),
  });

const getPromotionClaimId = (claim: DiscountClaimInstruction | undefined) => {
  if (!claim) return undefined;
  return Match.value(claim).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount_code: ({ codeId }) => codeId,
      voucher: ({ voucherId }) => voucherId,
    })
  );
};

type TransactionClient = Parameters<
  Parameters<WorkspaceDatabaseClient["transaction"]>[0]
>[0];

const decodeAccountingDocumentSnapshot = Schema.decodeUnknownEffect(
  accountingDocumentSnapshotSchema,
  { onExcessProperty: "error" }
);

const validatePaymentSessionAccountingSnapshot = Effect.fn(
  "PaymentLifecycle.validatePaymentSessionAccountingSnapshot"
)(function* (input: {
  readonly orderId: OrderId;
  readonly amount: WorkspaceMoney;
  readonly locale: Locale;
  readonly accountingSnapshot: AccountingDocumentSnapshot;
}) {
  const snapshot = yield* decodeAccountingDocumentSnapshot(
    input.accountingSnapshot
  ).pipe(
    Effect.mapError(
      () =>
        new AccountingDocumentSnapshotStorageError({
          operation: "validate",
          paymentReference: { type: "orderId", id: input.orderId },
          message: "Accounting snapshot schema is invalid.",
        })
    )
  );
  const snapshotAmount =
    "orderId" in snapshot
      ? snapshot.totals.payable
      : snapshot.quote.payment.expectedPrice;
  if (
    getAccountingDocumentOrderId(snapshot) !== input.orderId ||
    snapshot.locale !== input.locale ||
    !workspaceMoneyEquals(snapshotAmount, input.amount) ||
    (!("orderId" in snapshot) && !accountingSnapshotMoneyReconciles(snapshot))
  ) {
    return yield* new AccountingDocumentSnapshotStorageError({
      operation: "validate",
      paymentReference: { type: "orderId", id: input.orderId },
      message: "Accounting snapshot does not match the payment session.",
    });
  }
  return snapshot;
});

const validatePaymentSessionSnapshotOwner = Effect.fn(
  "PaymentLifecycle.validatePaymentSessionSnapshotOwner"
)(function* (input: {
  readonly snapshot: AccountingDocumentSnapshot;
  readonly order: typeof orders.$inferSelect;
  readonly reservation: typeof workspaceReservations.$inferSelect | null;
  readonly paymentReference: AccountingPaymentReference;
}) {
  if (
    input.snapshot.dotyposCustomerId !== input.order.dotyposCustomerId ||
    "orderId" in input.snapshot !== (input.order.kind === "goods") ||
    (!("orderId" in input.snapshot) &&
      input.reservation?.dotyposReservationId !==
        input.snapshot.dotyposReservationId)
  ) {
    return yield* new AccountingDocumentSnapshotStorageError({
      operation: "validate",
      paymentReference: input.paymentReference,
      message: "Accounting snapshot ownership is inconsistent.",
    });
  }
  if (
    "orderId" in input.snapshot &&
    (input.order.fulfillmentState !== "fulfilled" ||
      !input.order.fulfilledAt ||
      !Temporal.Instant.from(input.snapshot.fulfilledAt).equals(
        input.order.fulfilledAt
      ))
  ) {
    return yield* new AccountingDocumentSnapshotStorageError({
      operation: "validate",
      paymentReference: input.paymentReference,
      message: "Goods fulfilment evidence does not match the order.",
    });
  }
});

const lockReservationForAdmission = Effect.fn(
  "PaymentLifecycle.lockReservationForAdmission"
)(function* (input: {
  readonly tx: TransactionClient;
  readonly workspaceReservationId: WorkspaceReservationId;
}) {
  const [reservation] = yield* input.tx
    .select()
    .from(workspaceReservations)
    .where(eq(workspaceReservations.id, input.workspaceReservationId))
    .limit(1)
    .for("update");
  return reservation ?? null;
});

const validatePayableReservationForAdmission = Effect.fn(
  "PaymentLifecycle.validatePayableReservationForAdmission"
)(function* (input: {
  readonly reservation: typeof workspaceReservations.$inferSelect | null;
  readonly order: typeof orders.$inferSelect;
}) {
  const { reservation } = input;
  const now = Temporal.Now.instant();
  if (
    !reservation ||
    reservation.reservationState !== "held" ||
    !reservation.reservationHoldExpiresAt ||
    Temporal.Instant.compare(reservation.reservationHoldExpiresAt, now) <= 0 ||
    reservation.dotyposCustomerId !== input.order.dotyposCustomerId ||
    reservation.paymentState !== input.order.paymentState ||
    reservation.activePaymentAttemptId !== input.order.activePaymentAttemptId
  ) {
    return yield* lifecycleStateError(
      "admitPaymentSession",
      { type: "orderId", id: input.order.id },
      "Reservation payment admission requires a current held reservation."
    );
  }
  return reservation;
});

const loadActiveAttemptForAdmission = Effect.fn(
  "PaymentLifecycle.loadActiveAttemptForAdmission"
)(function* (input: {
  readonly tx: TransactionClient;
  readonly orderId: OrderId;
  readonly paymentAttemptId: PaymentAttemptId;
}) {
  const [attempt] = yield* input.tx
    .select()
    .from(paymentAttempts)
    .where(
      and(
        eq(paymentAttempts.id, input.paymentAttemptId),
        or(
          eq(paymentAttempts.orderId, input.orderId),
          and(
            isNull(paymentAttempts.orderId),
            sql`${paymentAttempts.workspaceReservationId} = ${input.orderId}`
          )
        )
      )
    )
    .limit(1)
    .for("update");
  if (!attempt) {
    return yield* lifecycleStateError(
      "admitPaymentSession",
      { type: "paymentAttemptId", id: input.paymentAttemptId },
      "The active payment attempt is missing or belongs to another order."
    );
  }
  return toPaymentAttempt(attempt);
});

const validateAccountingDocumentSnapshotForAttempt = Effect.fn(
  "PaymentLifecycle.validateAccountingDocumentSnapshotForAttempt"
)(function* (input: {
  readonly snapshot: AccountingDocumentSnapshot;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly paymentReference: AccountingPaymentReference;
  readonly amount: WorkspaceMoney;
  readonly locale: Locale;
}) {
  const snapshot = yield* decodeAccountingDocumentSnapshot(input.snapshot).pipe(
    Effect.mapError(
      () =>
        new AccountingDocumentSnapshotStorageError({
          operation: "validate",
          paymentReference: input.paymentReference,
          message: "Accounting snapshot schema is invalid.",
        })
    )
  );

  if ("orderId" in snapshot) {
    return yield* new AccountingDocumentSnapshotStorageError({
      operation: "validate",
      paymentReference: input.paymentReference,
      message: "Reservation payment requires a reservation snapshot.",
    });
  }
  if (
    snapshot.workspaceReservationId !== input.workspaceReservationId ||
    snapshot.locale !== input.locale ||
    !workspaceMoneyEquals(snapshot.quote.payment.expectedPrice, input.amount) ||
    !accountingSnapshotMoneyReconciles(snapshot)
  ) {
    return yield* new AccountingDocumentSnapshotStorageError({
      operation: "validate",
      paymentReference: input.paymentReference,
      message: "Accounting snapshot does not match the payment attempt.",
    });
  }

  return snapshot;
});

const accountingSnapshotMoneyReconciles = (
  snapshot: Exclude<AccountingDocumentSnapshot, { readonly orderId: OrderId }>
): boolean => {
  const { items, payment } = snapshot.quote;
  const sameUnit = (amount: WorkspaceMoney) =>
    amount.currency === payment.expectedPrice.currency &&
    amount.exponent === payment.expectedPrice.exponent;

  if (
    !sameUnit(payment.undiscountedPrice) ||
    !items.every(({ amount }) => sameUnit(amount)) ||
    !payment.discounts.every(
      ({ amount, subtotalAfter, subtotalBefore }) =>
        sameUnit(amount) && sameUnit(subtotalAfter) && sameUnit(subtotalBefore)
    )
  ) {
    return false;
  }

  const itemTotal = items.reduce((total, item) => total + item.amount.value, 0);
  const discountTotal = payment.discounts.reduce(
    (total, discount) => total + discount.amount.value,
    0
  );

  return (
    itemTotal === payment.undiscountedPrice.value &&
    itemTotal - discountTotal === payment.expectedPrice.value
  );
};

const validateAccountingDocumentSnapshotProviderIdentity = Effect.fn(
  "PaymentLifecycle.validateAccountingDocumentSnapshotProviderIdentity"
)(function* (input: {
  readonly snapshot: AccountingDocumentSnapshot;
  readonly paymentReference: AccountingPaymentReference;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly dotyposReservationId: DotyposReservationId | null;
}) {
  if ("orderId" in input.snapshot) {
    return yield* new AccountingDocumentSnapshotStorageError({
      operation: "validate",
      paymentReference: input.paymentReference,
      message: "Reservation payment requires a reservation snapshot.",
    });
  }
  if (
    input.snapshot.dotyposCustomerId !== input.dotyposCustomerId ||
    input.snapshot.dotyposReservationId !== input.dotyposReservationId
  ) {
    return yield* new AccountingDocumentSnapshotStorageError({
      operation: "validate",
      paymentReference: input.paymentReference,
      message: "Accounting snapshot provider identity is inconsistent.",
    });
  }
});

const persistAccountingDocumentSnapshot = Effect.fn(
  "PaymentLifecycle.persistAccountingDocumentSnapshot"
)(function* (input: {
  readonly tx: TransactionClient;
  readonly orderId: OrderId;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId | null;
  readonly snapshot: AccountingDocumentSnapshot;
  readonly key: AccountingSnapshotKey;
}) {
  const snapshotJson = JSON.stringify(
    encodeStoredAccountingDocumentSnapshot(input.snapshot)
  );

  yield* input.tx
    .insert(accountingDocumentSnapshots)
    .values({
      paymentAttemptId: input.paymentAttemptId,
      orderId: input.orderId,
      workspaceReservationId: input.workspaceReservationId,
      keyId: input.key.id,
      encryptedSnapshot: encryptAccountingSnapshot(
        snapshotJson,
        input.key.secret
      ),
    })
    .pipe(
      Effect.withTracerEnabled(false),
      Effect.mapError(
        () =>
          new AccountingDocumentSnapshotStorageError({
            operation: "encrypt",
            paymentReference: {
              type: "paymentAttemptId",
              id: input.paymentAttemptId,
            },
            message: "Accounting snapshot could not be encrypted.",
          })
      )
    );
});

const reserveCommittedCodeClaim = Effect.fn(
  "PaymentLifecycle.reserveCommittedCodeClaim"
)(function* (input: {
  readonly tx: TransactionClient;
  readonly claimedApplication: ClaimedDiscountApplication | undefined;
  readonly applicationRows: readonly PersistedDiscountApplication[];
  readonly orderId: OrderId;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly locale: Locale;
  readonly reservationCustomerId: DotyposCustomerId;
  readonly reservationExpiresAt: Temporal.Instant;
}) {
  if (!input.claimedApplication) return;

  const applicationId = input.applicationRows.find(
    (application) => application.sequence === input.claimedApplication?.index
  )?.id;

  if (!applicationId) {
    return yield* claimError(
      "reserve",
      "claim_conflict",
      "The claimed discount application was not persisted.",
      input.claimedApplication.claim
    );
  }

  return yield* admitOrderDiscountClaim({
    tx: input.tx,
    claim: input.claimedApplication.claim,
    application: input.claimedApplication.application,
    applicationId,
    orderId: input.orderId,
    ownership: {
      kind: "reservation_attempt",
      paymentAttemptId: input.paymentAttemptId,
      reservationExpiresAt: input.reservationExpiresAt,
    },
    locale: input.locale,
    orderCustomerId: input.reservationCustomerId,
  });
});

const activeClaimConstraints = new Set([
  "discount_code_redemptions_application_unique_idx",
  "discount_code_redemptions_attempt_unique_idx",
  "voucher_redemptions_active_customer_unique_idx",
  "voucher_redemptions_application_unique_idx",
  "voucher_redemptions_attempt_unique_idx",
]);

const getUniqueConstraint = (cause: unknown): string | undefined => {
  if (!Predicate.isObject(cause)) return undefined;
  if (
    "_tag" in cause &&
    cause._tag === "UniqueViolation" &&
    "constraint" in cause &&
    Predicate.isString(cause.constraint)
  ) {
    return cause.constraint;
  }
  if ("reason" in cause) {
    const constraint = getUniqueConstraint(cause.reason);
    if (constraint) return constraint;
  }
  if ("cause" in cause) return getUniqueConstraint(cause.cause);
  return undefined;
};

const isActiveClaimUniqueViolation = (cause: unknown) => {
  const constraint = getUniqueConstraint(cause);
  return constraint !== undefined && activeClaimConstraints.has(constraint);
};
