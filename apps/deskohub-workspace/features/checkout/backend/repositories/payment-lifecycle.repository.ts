import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import type {
  NexiOperationId,
  NexiOrderId,
  NexiWebhookEventId,
} from "@deskohub/nexi";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Predicate, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import {
  accountingDocumentSnapshots,
  discountApplications,
  discountCodeRedemptions,
  discountCodes,
  discountProductTargets,
  discounts,
  paymentAttempts,
  promotionCodeCustomers,
  promotionCodes,
  voucherRedemptions,
  vouchers,
  workspaceReservations,
} from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
  encodeStoredAccountingDocumentSnapshot,
} from "@/features/accounting/accounting-document-snapshot";
import {
  AccountingDocumentSnapshotStorageError,
  type AccountingPaymentReference,
} from "@/features/accounting/backend/accounting-document-snapshot.repository";
import {
  type AccountingSnapshotKey,
  AccountingSnapshotKeyService,
} from "@/features/accounting/backend/accounting-snapshot-key.service";
import { AccountingSnapshotKeyServiceLive } from "@/features/accounting/backend/accounting-snapshot-key-live.server";
import { encryptAccountingSnapshot } from "@/features/accounting/backend/accounting-snapshot-sql";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import { getWorkspaceProductKey } from "@/features/checkout/product-identity";
import {
  type WorkspaceMoney,
  workspaceMoneyEquals,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import {
  type DiscountCommitment,
  getDiscountCommitmentPayload,
} from "@/features/discounts/commitment";
import type {
  AppliedDiscount,
  DiscountAdjustment,
} from "@/features/discounts/contracts";
import { decodeDiscountDefinition } from "@/features/discounts/discount-definition";
import { DiscountClaimError } from "@/features/discounts/errors";
import { deriveOpaqueDiscountId } from "@/features/discounts/opaque-discount-id";
import type {
  DiscountApplicationId,
  DiscountCodeId,
  VoucherId,
} from "@/features/discounts/persistence-contracts";
import { getWorkspaceProductTarget } from "@/features/discounts/product-target";
import { getPromotionTiming } from "@/features/discounts/promotion-code";
import type { DiscountClaimInstruction } from "@/features/discounts/provider";
import { type Locale, m } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";
import {
  type PaymentAttempt,
  toPaymentAttempt,
} from "./payment-attempt.repository";

export type PaymentLifecycleReference =
  | { readonly type: "paymentAttemptId"; readonly id: PaymentAttemptId }
  | { readonly type: "providerOrderId"; readonly id: NexiOrderId }
  | {
      readonly type: "workspaceReservationId";
      readonly id: WorkspaceReservationId;
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

export type PaymentLifecycleRepositoryError =
  | AccountingDocumentSnapshotStorageError
  | DiscountClaimError
  | EffectDrizzleQueryError
  | PaymentLifecycleStateError
  | SqlError;

export interface IPaymentLifecycleRepository {
  readonly createPendingNexiAttempt: (input: {
    readonly workspaceReservationId: WorkspaceReservationId;
    readonly providerOrderId: NexiOrderId;
    readonly amount: WorkspaceMoney;
    readonly commitment: DiscountCommitment;
    readonly locale: Locale;
    readonly accountingSnapshot: AccountingDocumentSnapshot;
  }) => Effect.Effect<PaymentAttempt, PaymentLifecycleRepositoryError>;
  readonly completeInternalPayment: (input: {
    readonly workspaceReservationId: WorkspaceReservationId;
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
    readonly workspaceReservationId: WorkspaceReservationId;
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
    readonly workspaceReservationId: WorkspaceReservationId;
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
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const accountingSnapshotKeys = yield* AccountingSnapshotKeyService;

      const createPendingNexiAttempt = Effect.fn(
        "PaymentLifecycleRepository.createPendingNexiAttempt"
      )(function* (input: {
        readonly workspaceReservationId: WorkspaceReservationId;
        readonly providerOrderId: NexiOrderId;
        readonly amount: WorkspaceMoney;
        readonly commitment: DiscountCommitment;
        readonly locale: Locale;
        readonly accountingSnapshot: AccountingDocumentSnapshot;
      }) {
        const accountingSnapshot =
          yield* validateAccountingDocumentSnapshotForAttempt({
            snapshot: input.accountingSnapshot,
            workspaceReservationId: input.workspaceReservationId,
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
          yield* validateDiscountCommitment(commitment);

        return yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const [reservation] = yield* tx
                .select({
                  id: workspaceReservations.id,
                  dotyposCustomerId: workspaceReservations.dotyposCustomerId,
                  dotyposReservationId:
                    workspaceReservations.dotyposReservationId,
                  reservationHoldExpiresAt:
                    workspaceReservations.reservationHoldExpiresAt,
                })
                .from(workspaceReservations)
                .where(
                  and(
                    eq(workspaceReservations.id, input.workspaceReservationId),
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
                  workspaceReservationId: input.workspaceReservationId,
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
                paymentAttemptId: attemptRow.id,
                workspaceReservationId: input.workspaceReservationId,
                snapshot: accountingSnapshot,
                key: accountingSnapshotKey,
              });

              const [linked] = yield* tx
                .update(workspaceReservations)
                .set({
                  activePaymentAttemptId: attemptRow.id,
                  paymentState: "pending",
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(workspaceReservations.id, input.workspaceReservationId),
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

              if (!linked) {
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

              const applicationRows = yield* persistDiscountApplications({
                tx,
                commitment,
                paymentAttemptId: attemptRow.id,
                workspaceReservationId: input.workspaceReservationId,
              });
              yield* reserveCommittedCodeClaim({
                tx,
                claimedApplication,
                applicationRows,
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
        readonly workspaceReservationId: WorkspaceReservationId;
        readonly amount: WorkspaceMoney;
        readonly commitment: DiscountCommitment;
        readonly locale: Locale;
        readonly accountingSnapshot: AccountingDocumentSnapshot;
      }) {
        const accountingSnapshot =
          yield* validateAccountingDocumentSnapshotForAttempt({
            snapshot: input.accountingSnapshot,
            workspaceReservationId: input.workspaceReservationId,
            amount: input.amount,
            locale: input.locale,
            paymentReference: {
              type: "workspaceReservationId",
              id: input.workspaceReservationId,
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
              type: "workspaceReservationId",
              id: input.workspaceReservationId,
            },
            "Internal payments require an exactly zero payable amount."
          );
        }

        return yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const [reservation] = yield* tx
                .select({
                  id: workspaceReservations.id,
                  activePaymentAttemptId:
                    workspaceReservations.activePaymentAttemptId,
                  dotyposCustomerId: workspaceReservations.dotyposCustomerId,
                  dotyposReservationId:
                    workspaceReservations.dotyposReservationId,
                  paidAt: workspaceReservations.paidAt,
                  paymentState: workspaceReservations.paymentState,
                  reservationHoldExpiresAt:
                    workspaceReservations.reservationHoldExpiresAt,
                  reservationState: workspaceReservations.reservationState,
                })
                .from(workspaceReservations)
                .where(
                  eq(workspaceReservations.id, input.workspaceReservationId)
                )
                .limit(1)
                .for("update");

              const paidAt = Temporal.Now.instant();

              if (
                reservation?.paymentState === "paid" &&
                reservation.activePaymentAttemptId
              ) {
                const [existingAttempt] = yield* tx
                  .select()
                  .from(paymentAttempts)
                  .where(
                    and(
                      eq(
                        paymentAttempts.id,
                        reservation.activePaymentAttemptId
                      ),
                      eq(
                        paymentAttempts.workspaceReservationId,
                        input.workspaceReservationId
                      ),
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
                reservation?.reservationState !== "held" ||
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
                    type: "workspaceReservationId",
                    id: input.workspaceReservationId,
                  },
                  "Internal payments can only complete a current held unpaid reservation."
                );
              }

              yield* validateAccountingDocumentSnapshotProviderIdentity({
                snapshot: accountingSnapshot,
                paymentReference: {
                  type: "workspaceReservationId",
                  id: input.workspaceReservationId,
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
                          id: input.workspaceReservationId,
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
                  workspaceReservationId: input.workspaceReservationId,
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
                paymentAttemptId: attemptRow.id,
                workspaceReservationId: input.workspaceReservationId,
                snapshot: accountingSnapshot,
                key: accountingSnapshotKey,
              });

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
                    eq(workspaceReservations.id, input.workspaceReservationId),
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

              if (!completedReservation) {
                return yield* lifecycleStateError(
                  "completeInternalPayment",
                  { type: "paymentAttemptId", id: attemptRow.id },
                  "Internal payment could not atomically complete the held reservation."
                );
              }

              const applicationRows = yield* persistDiscountApplications({
                tx,
                commitment,
                paymentAttemptId: attemptRow.id,
                workspaceReservationId: input.workspaceReservationId,
              });
              const claimedAt = yield* reserveCommittedCodeClaim({
                tx,
                claimedApplication,
                applicationRows,
                paymentAttemptId: attemptRow.id,
                locale: input.locale,
                reservationCustomerId: reservation.dotyposCustomerId,
                reservationExpiresAt: reservation.reservationHoldExpiresAt,
              });
              if (claimedAt) {
                yield* redeemCodeClaim(tx, attemptRow.id, claimedAt);
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
          readonly workspaceReservationId: WorkspaceReservationId;
          readonly webhookEventId?: NexiWebhookEventId;
          readonly providerOperationId?: NexiOperationId;
          readonly providerStatus?: string;
          readonly paidAt: Temporal.Instant;
        }) {
          return yield* db.transaction((tx) =>
            Effect.gen(function* () {
              const [attempt] = yield* tx
                .update(paymentAttempts)
                .set({
                  state: "paid",
                  lastWebhookEventId: input.webhookEventId,
                  lastProviderOperationId: input.providerOperationId,
                  lastProviderStatus: input.providerStatus,
                  failureCode: null,
                  updatedAt: input.paidAt,
                })
                .where(
                  and(
                    eq(paymentAttempts.id, input.id),
                    eq(
                      paymentAttempts.workspaceReservationId,
                      input.workspaceReservationId
                    ),
                    inArray(paymentAttempts.state, [
                      "created",
                      "pending",
                      "paid",
                    ])
                  )
                )
                .returning();

              if (!attempt) {
                return yield* lifecycleStateError(
                  "markPaid",
                  { type: "paymentAttemptId", id: input.id },
                  "Only a created, pending, or already-paid attempt can mark a reservation paid."
                );
              }

              const [reservation] = yield* tx
                .update(workspaceReservations)
                .set({
                  paymentState: "paid",
                  paidAt: input.paidAt,
                  failureCode: null,
                  updatedAt: input.paidAt,
                })
                .where(
                  and(
                    eq(workspaceReservations.id, input.workspaceReservationId),
                    eq(workspaceReservations.reservationState, "held"),
                    eq(workspaceReservations.paymentState, "pending"),
                    eq(workspaceReservations.activePaymentAttemptId, input.id)
                  )
                )
                .returning({ paidAt: workspaceReservations.paidAt });

              if (reservation) {
                yield* redeemCodeClaim(tx, input.id, input.paidAt);
                return {
                  attempt: toPaymentAttempt(attempt),
                  changed: true,
                  timestamp: reservation.paidAt ?? input.paidAt,
                };
              }

              const [consistent] = yield* tx
                .select({ paidAt: workspaceReservations.paidAt })
                .from(workspaceReservations)
                .where(
                  and(
                    eq(workspaceReservations.id, input.workspaceReservationId),
                    eq(workspaceReservations.paymentState, "paid"),
                    eq(workspaceReservations.activePaymentAttemptId, input.id)
                  )
                )
                .limit(1);

              if (!consistent) {
                return yield* lifecycleStateError(
                  "markPaid",
                  { type: "paymentAttemptId", id: input.id },
                  "Only the active pending attempt on a held reservation can mark payment paid."
                );
              }

              yield* redeemCodeClaim(tx, input.id, input.paidAt);
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
          readonly workspaceReservationId: WorkspaceReservationId;
          readonly state: "failed" | "cancelled" | "expired";
          readonly failureCode: string;
          readonly webhookEventId?: NexiWebhookEventId;
          readonly providerOperationId?: NexiOperationId;
          readonly providerStatus?: string;
        }) {
          const terminalAt = Temporal.Now.instant();

          return yield* db.transaction((tx) =>
            Effect.gen(function* () {
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
                    eq(
                      paymentAttempts.workspaceReservationId,
                      input.workspaceReservationId
                    ),
                    inArray(paymentAttempts.state, [
                      "created",
                      "pending",
                      input.state,
                    ])
                  )
                )
                .returning();

              if (!attempt) {
                return yield* lifecycleStateError(
                  "markTerminal",
                  { type: "paymentAttemptId", id: input.id },
                  "Only a non-terminal or matching terminal attempt can mark a reservation terminal."
                );
              }

              yield* tx
                .delete(accountingDocumentSnapshots)
                .where(
                  eq(accountingDocumentSnapshots.paymentAttemptId, input.id)
                );

              const [reservation] = yield* tx
                .update(workspaceReservations)
                .set({
                  paymentState: input.state,
                  failureCode: input.failureCode,
                  updatedAt: terminalAt,
                })
                .where(
                  and(
                    eq(workspaceReservations.id, input.workspaceReservationId),
                    eq(workspaceReservations.reservationState, "held"),
                    eq(workspaceReservations.paymentState, "pending"),
                    eq(workspaceReservations.activePaymentAttemptId, input.id)
                  )
                )
                .returning({ updatedAt: workspaceReservations.updatedAt });

              if (reservation) {
                yield* releaseCodeClaim(
                  tx,
                  input.id,
                  terminalAt,
                  input.failureCode
                );
                return {
                  attempt: toPaymentAttempt(attempt),
                  changed: true,
                  timestamp: reservation.updatedAt,
                };
              }

              const [consistent] = yield* tx
                .select({ updatedAt: workspaceReservations.updatedAt })
                .from(workspaceReservations)
                .where(
                  and(
                    eq(workspaceReservations.id, input.workspaceReservationId),
                    eq(workspaceReservations.paymentState, input.state),
                    eq(workspaceReservations.activePaymentAttemptId, input.id)
                  )
                )
                .limit(1);

              if (!consistent) {
                return yield* lifecycleStateError(
                  "markTerminal",
                  { type: "paymentAttemptId", id: input.id },
                  "Only the active pending attempt on a held reservation can mark payment terminal."
                );
              }

              yield* releaseCodeClaim(
                tx,
                input.id,
                terminalAt,
                input.failureCode
              );
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
        createPendingNexiAttempt,
        completeInternalPayment,
        attachProviderSession,
        markPaid,
        markTerminal,
      } satisfies IPaymentLifecycleRepository;
    }).pipe(Effect.provide(AccountingSnapshotKeyServiceLive))
  );
}

type CommitmentPayload = ReturnType<typeof getDiscountCommitmentPayload>;

export const validateDiscountCommitment = Effect.fn(
  "PaymentLifecycle.validateDiscountCommitment"
)(function* (commitment: CommitmentPayload) {
  const claimedApplicationIndex = commitment.applications.findIndex(
    ({ claim }) => claim !== undefined
  );

  if (
    claimedApplicationIndex >= 0 &&
    commitment.applications.some(
      ({ claim }, index) =>
        index > claimedApplicationIndex && claim !== undefined
    )
  ) {
    return yield* new DiscountClaimError({
      operation: "reserve",
      reason: "claim_conflict",
      message: "A payment attempt can reserve at most one discount code.",
    });
  }

  for (const { application, claim } of commitment.applications) {
    const amountInSubtotalUnit = workspaceMoneyWithValue(
      application.amount.value,
      application.subtotalBefore
    );
    const expectedSubtotalAfter = workspaceMoneyWithValue(
      application.subtotalBefore.value - application.amount.value,
      application.subtotalBefore
    );

    if (
      !workspaceMoneyEquals(amountInSubtotalUnit, application.amount) ||
      !workspaceMoneyEquals(expectedSubtotalAfter, application.subtotalAfter)
    ) {
      return yield* new DiscountClaimError({
        operation: "reserve",
        reason: "money_mismatch",
        message: "A committed discount application has inconsistent money.",
        codeId:
          claim?.kind === "discount_code" ? claim.codeId : claim?.voucherId,
      });
    }

    if (
      claim?.kind === "discount_code" &&
      getWorkspaceProductKey(claim.product) !==
        getWorkspaceProductKey(commitment.product)
    ) {
      return yield* claimError(
        "reserve",
        "product_ineligible",
        "The discount-code claim targets a different product.",
        claim
      );
    }
  }

  if (claimedApplicationIndex < 0) return undefined;

  const claimedApplication = commitment.applications[claimedApplicationIndex];
  if (!claimedApplication?.claim) return undefined;

  return {
    index: claimedApplicationIndex,
    application: claimedApplication.application,
    claim: claimedApplication.claim,
  };
});

export const validateInternalPaymentCommitment = Effect.fn(
  "PaymentLifecycle.validateInternalPaymentCommitment"
)(function* (commitment: CommitmentPayload, amount: WorkspaceMoney) {
  const claimedApplication = yield* validateDiscountCommitment(commitment);
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
    codeId: claim?.kind === "discount_code" ? claim.codeId : claim?.voucherId,
  });

const discountAdjustmentsEqual = (
  left: DiscountAdjustment,
  right: DiscountAdjustment
) => {
  if (left.kind !== right.kind) return false;
  if (left.kind === "percentage" && right.kind === "percentage") {
    return left.basisPoints === right.basisPoints;
  }
  if (left.kind === "fixed" && right.kind === "fixed") {
    return workspaceMoneyEquals(left.amount, right.amount);
  }
  return false;
};

type TransactionClient = Parameters<
  Parameters<WorkspaceDatabaseClient["transaction"]>[0]
>[0];

const decodeAccountingDocumentSnapshot = Schema.decodeUnknownEffect(
  accountingDocumentSnapshotSchema,
  { onExcessProperty: "error" }
);

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
  snapshot: AccountingDocumentSnapshot
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
  readonly paymentAttemptId: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId;
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

type ClaimedApplication = {
  readonly index: number;
  readonly application: AppliedDiscount;
  readonly claim: DiscountClaimInstruction;
};

type PersistedApplication = {
  readonly id: DiscountApplicationId;
  readonly sequence: number;
};

const persistDiscountApplications = Effect.fn(
  "PaymentLifecycle.persistDiscountApplications"
)(function* (input: {
  readonly tx: TransactionClient;
  readonly commitment: CommitmentPayload;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId;
}) {
  if (input.commitment.applications.length === 0) {
    return [] satisfies PersistedApplication[];
  }

  return yield* input.tx
    .insert(discountApplications)
    .values(
      input.commitment.applications.map(
        ({ application, provenance }, sequence) => ({
          paymentAttemptId: input.paymentAttemptId,
          workspaceReservationId: input.workspaceReservationId,
          sequence,
          publicDiscountId: application.discount.id,
          label: application.discount.label,
          adjustment: application.discount.adjustment,
          productIdentity: input.commitment.product,
          subtotalBeforeValue: application.subtotalBefore.value,
          subtotalBeforeExponent: application.subtotalBefore.exponent,
          subtotalBeforeCurrency: application.subtotalBefore.currency,
          appliedAmountValue: application.amount.value,
          appliedAmountExponent: application.amount.exponent,
          appliedAmountCurrency: application.amount.currency,
          subtotalAfterValue: application.subtotalAfter.value,
          subtotalAfterExponent: application.subtotalAfter.exponent,
          subtotalAfterCurrency: application.subtotalAfter.currency,
          expiresAt: application.discount.expiresAt
            ? Temporal.Instant.from(application.discount.expiresAt)
            : null,
          countdownStartsAt: application.discount.countdownStartsAt
            ? Temporal.Instant.from(application.discount.countdownStartsAt)
            : null,
          provenance,
        })
      )
    )
    .returning({
      id: discountApplications.id,
      sequence: discountApplications.sequence,
    });
});

const reserveCommittedCodeClaim = Effect.fn(
  "PaymentLifecycle.reserveCommittedCodeClaim"
)(function* (input: {
  readonly tx: TransactionClient;
  readonly claimedApplication: ClaimedApplication | undefined;
  readonly applicationRows: readonly PersistedApplication[];
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

  return yield* reserveCodeClaim({
    tx: input.tx,
    claim: input.claimedApplication.claim,
    application: input.claimedApplication.application,
    applicationId,
    paymentAttemptId: input.paymentAttemptId,
    locale: input.locale,
    reservationCustomerId: input.reservationCustomerId,
    reservationExpiresAt: input.reservationExpiresAt,
  });
});

const reserveCodeClaim = Effect.fn("PaymentLifecycle.reserveCodeClaim")(
  function* (input: {
    readonly tx: TransactionClient;
    readonly claim: DiscountClaimInstruction;
    readonly application: AppliedDiscount;
    readonly applicationId: DiscountApplicationId;
    readonly paymentAttemptId: PaymentAttemptId;
    readonly locale: Locale;
    readonly reservationCustomerId: DotyposCustomerId;
    readonly reservationExpiresAt: Temporal.Instant;
  }) {
    if (input.reservationCustomerId !== input.claim.dotyposCustomerId) {
      return yield* claimError(
        "reserve",
        "customer_ineligible",
        "The discount-code claim customer does not match the reservation.",
        input.claim
      );
    }

    const stored = yield* input.claim.kind === "discount_code"
      ? input.tx
          .select({ promotion: promotionCodes, code: discountCodes })
          .from(discountCodes)
          .innerJoin(
            promotionCodes,
            eq(promotionCodes.id, discountCodes.promotionCodeId)
          )
          .where(eq(discountCodes.id, input.claim.codeId))
          .limit(1)
          .for("update")
          .pipe(
            Effect.map((rows) =>
              rows[0]
                ? ({ kind: "discount_code", ...rows[0] } as const)
                : undefined
            )
          )
      : input.tx
          .select({ promotion: promotionCodes, voucher: vouchers })
          .from(vouchers)
          .innerJoin(
            promotionCodes,
            eq(promotionCodes.id, vouchers.promotionCodeId)
          )
          .where(eq(vouchers.id, input.claim.voucherId))
          .limit(1)
          .for("update")
          .pipe(
            Effect.map((rows) =>
              rows[0] ? ({ kind: "voucher", ...rows[0] } as const) : undefined
            )
          );

    if (
      !stored ||
      (stored.kind === "discount_code" &&
        input.claim.kind === "discount_code" &&
        stored.code.discountId !== input.claim.storedDiscountId)
    ) {
      return yield* claimError(
        "reserve",
        "unknown_code",
        "The accepted promotion no longer exists.",
        input.claim
      );
    }
    if (!stored.promotion.enabled) {
      return yield* claimError(
        "reserve",
        "inactive",
        "The accepted promotion is inactive.",
        input.claim
      );
    }

    const claimedAt = Temporal.Now.instant();
    if (Temporal.Instant.compare(input.reservationExpiresAt, claimedAt) <= 0) {
      return yield* lifecycleStateError(
        "reserveCodeClaim",
        { type: "paymentAttemptId", id: input.paymentAttemptId },
        "Discount claims can only be reserved for a current held reservation."
      );
    }
    if (
      stored.promotion.validFrom &&
      Temporal.Instant.compare(claimedAt, stored.promotion.validFrom) < 0
    ) {
      return yield* claimError(
        "reserve",
        "not_started",
        "The accepted promotion is not valid yet.",
        input.claim
      );
    }
    if (
      stored.promotion.validUntil &&
      Temporal.Instant.compare(claimedAt, stored.promotion.validUntil) >= 0
    ) {
      return yield* claimError(
        "reserve",
        "expired",
        "The accepted promotion has expired.",
        input.claim
      );
    }

    const [allowlist] = yield* input.tx
      .select({ count: count() })
      .from(promotionCodeCustomers)
      .where(eq(promotionCodeCustomers.promotionCodeId, stored.promotion.id));
    if ((allowlist?.count ?? 0) > 0) {
      const [customer] = yield* input.tx
        .select({ promotionCodeId: promotionCodeCustomers.promotionCodeId })
        .from(promotionCodeCustomers)
        .where(
          and(
            eq(promotionCodeCustomers.promotionCodeId, stored.promotion.id),
            eq(
              promotionCodeCustomers.dotyposCustomerId,
              input.claim.dotyposCustomerId
            )
          )
        )
        .limit(1);
      if (!customer) {
        return yield* claimError(
          "reserve",
          "customer_ineligible",
          "The customer is no longer eligible for the accepted promotion.",
          input.claim
        );
      }
    }

    yield* stored.kind === "discount_code"
      ? validateStoredDiscountClaim({
          ...input,
          claim: input.claim as Extract<
            DiscountClaimInstruction,
            { readonly kind: "discount_code" }
          >,
          code: stored.code,
          promotion: stored.promotion,
        })
      : validateVoucherClaim({
          ...input,
          claim: input.claim as Extract<
            DiscountClaimInstruction,
            { readonly kind: "voucher" }
          >,
          voucher: stored.voucher,
          promotion: stored.promotion,
        });

    if (stored.kind === "discount_code") {
      const [customerUses] = yield* input.tx
        .select({ count: count() })
        .from(discountCodeRedemptions)
        .where(
          and(
            eq(discountCodeRedemptions.codeId, stored.code.id),
            eq(
              discountCodeRedemptions.dotyposCustomerId,
              input.claim.dotyposCustomerId
            ),
            inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
          )
        );
      if (
        stored.code.maxUsesPerCustomer !== null &&
        (customerUses?.count ?? 0) >= stored.code.maxUsesPerCustomer
      ) {
        return yield* claimError(
          "reserve",
          "usage_limit_reached",
          "The customer has no remaining uses for this discount code.",
          input.claim
        );
      }
    } else {
      const [customerUse] = yield* input.tx
        .select({ state: voucherRedemptions.state })
        .from(voucherRedemptions)
        .where(
          and(
            eq(voucherRedemptions.voucherId, stored.voucher.id),
            eq(
              voucherRedemptions.dotyposCustomerId,
              input.claim.dotyposCustomerId
            ),
            eq(voucherRedemptions.state, "reserved")
          )
        )
        .limit(1);
      if (customerUse) {
        return yield* claimError(
          "reserve",
          "claim_conflict",
          "The customer already has an active claim for this voucher.",
          input.claim
        );
      }
    }

    if (stored.kind === "discount_code" && stored.code.maxUses !== null) {
      const [uses] = yield* input.tx
        .select({ count: count() })
        .from(discountCodeRedemptions)
        .where(
          and(
            eq(discountCodeRedemptions.codeId, stored.code.id),
            inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
          )
        );

      if ((uses?.count ?? 0) >= stored.code.maxUses) {
        return yield* claimError(
          "reserve",
          "usage_limit_reached",
          "The accepted discount code has no remaining uses.",
          input.claim
        );
      }
    }

    const claimValues = {
      applicationId: input.applicationId,
      paymentAttemptId: input.paymentAttemptId,
      dotyposCustomerId: input.claim.dotyposCustomerId,
      state: "reserved" as const,
      reservationExpiresAt: input.reservationExpiresAt,
      reservedAt: claimedAt,
      updatedAt: claimedAt,
    };
    yield* stored.kind === "discount_code"
      ? input.tx.insert(discountCodeRedemptions).values({
          ...claimValues,
          codeId: stored.code.id,
        })
      : input.tx.insert(voucherRedemptions).values({
          ...claimValues,
          voucherId: stored.voucher.id,
        });
    return claimedAt;
  }
);

const validateStoredDiscountClaim = Effect.fn(
  "PaymentLifecycle.validateStoredDiscountClaim"
)(function* (input: {
  readonly tx: TransactionClient;
  readonly claim: Extract<
    DiscountClaimInstruction,
    { readonly kind: "discount_code" }
  >;
  readonly code: typeof discountCodes.$inferSelect;
  readonly promotion: typeof promotionCodes.$inferSelect;
  readonly application: AppliedDiscount;
  readonly locale: Locale;
}) {
  const [definition] = yield* input.tx
    .select()
    .from(discounts)
    .where(eq(discounts.id, input.claim.storedDiscountId))
    .limit(1)
    .for("update");
  if (!definition) {
    return yield* claimError(
      "reserve",
      "unknown_code",
      "The accepted discount benefit no longer exists.",
      input.claim
    );
  }

  const [target] = yield* input.tx
    .select({ discountId: discountProductTargets.discountId })
    .from(discountProductTargets)
    .where(
      and(
        eq(discountProductTargets.discountId, input.claim.storedDiscountId),
        eq(
          discountProductTargets.productTarget,
          getWorkspaceProductTarget(input.claim.product)
        )
      )
    )
    .limit(1)
    .for("update");
  if (!target) {
    return yield* claimError(
      "reserve",
      "product_ineligible",
      "The accepted discount code no longer targets this product.",
      input.claim
    );
  }

  const currentDefinition = yield* decodeDiscountDefinition({
    row: {
      ...definition,
      productTargets: [
        {
          discountId: target.discountId,
          productTarget: getWorkspaceProductTarget(input.claim.product),
        },
      ],
    },
  }).pipe(
    Effect.mapError(
      (cause) =>
        new DiscountClaimError({
          operation: "reserve",
          reason: "malformed_configuration",
          message: "The accepted discount benefit is malformed.",
          codeId: input.claim.codeId,
          cause,
        })
    )
  );
  const timing = getPromotionTiming(input.promotion.validUntil);
  if (
    !discountAdjustmentsEqual(
      currentDefinition.adjustment,
      input.application.discount.adjustment
    ) ||
    currentDefinition.labels[input.locale] !==
      input.application.discount.label ||
    timing.expiresAt !== input.application.discount.expiresAt ||
    timing.countdownStartsAt !== input.application.discount.countdownStartsAt
  ) {
    return yield* claimError(
      "reserve",
      "claim_conflict",
      "The accepted discount benefit changed before claim admission.",
      input.claim
    );
  }
});

const validateVoucherClaim = Effect.fn("PaymentLifecycle.validateVoucherClaim")(
  function* (input: {
    readonly tx: TransactionClient;
    readonly claim: Extract<
      DiscountClaimInstruction,
      { readonly kind: "voucher" }
    >;
    readonly voucher: typeof vouchers.$inferSelect;
    readonly promotion: typeof promotionCodes.$inferSelect;
    readonly application: AppliedDiscount;
    readonly locale: Locale;
  }) {
    const [usage] = yield* input.tx
      .select({
        value: sql<number>`coalesce(sum(${discountApplications.appliedAmountValue}), 0)::integer`,
      })
      .from(voucherRedemptions)
      .innerJoin(
        discountApplications,
        eq(discountApplications.id, voucherRedemptions.applicationId)
      )
      .where(
        and(
          eq(voucherRedemptions.voucherId, input.claim.voucherId),
          inArray(voucherRedemptions.state, ["reserved", "redeemed"])
        )
      );
    const availableAmount = {
      value: input.voucher.issuedAmountValue - (usage?.value ?? 0),
      exponent: input.voucher.issuedAmountExponent,
      currency: input.voucher.issuedAmountCurrency,
    };
    const adjustment = input.application.discount.adjustment;
    const timing = getPromotionTiming(input.promotion.validUntil);
    const discountId = deriveOpaqueDiscountId({
      providerNamespace: "database-voucher",
      providerReference: input.claim.voucherId,
    });
    if (
      !workspaceMoneyEquals(availableAmount, input.claim.availableAmount) ||
      adjustment.kind !== "fixed" ||
      !workspaceMoneyEquals(adjustment.amount, availableAmount) ||
      input.application.amount.value > availableAmount.value ||
      input.application.discount.id !== discountId ||
      input.application.discount.label !==
        m.checkoutVoucherLabel({}, { locale: input.locale }) ||
      timing.expiresAt !== input.application.discount.expiresAt ||
      timing.countdownStartsAt !== input.application.discount.countdownStartsAt
    ) {
      return yield* claimError(
        "reserve",
        "claim_conflict",
        "The accepted voucher credit changed before claim admission.",
        input.claim
      );
    }
  }
);

const redeemCodeClaim = Effect.fn("PaymentLifecycle.redeemCodeClaim")(
  function* (
    tx: TransactionClient,
    paymentAttemptId: PaymentAttemptId,
    redeemedAt: Temporal.Instant
  ) {
    const [discountClaims, voucherClaims] = yield* Effect.all([
      tx
        .select({
          id: discountCodeRedemptions.codeId,
          state: discountCodeRedemptions.state,
        })
        .from(discountCodeRedemptions)
        .where(eq(discountCodeRedemptions.paymentAttemptId, paymentAttemptId))
        .limit(1)
        .for("update"),
      tx
        .select({
          id: voucherRedemptions.voucherId,
          state: voucherRedemptions.state,
        })
        .from(voucherRedemptions)
        .where(eq(voucherRedemptions.paymentAttemptId, paymentAttemptId))
        .limit(1)
        .for("update"),
    ]);
    const claim = selectStoredPromotionClaim(
      discountClaims[0],
      voucherClaims[0]
    );

    if (!claim) return;
    if (claim.state === "released") {
      return yield* new DiscountClaimError({
        operation: "redeem",
        reason: "claim_conflict",
        message: "A released promotion claim cannot be redeemed.",
        codeId: claim.id,
      });
    }
    if (claim.state === "redeemed") return;

    const values = {
      state: "redeemed" as const,
      redeemedAt,
      updatedAt: redeemedAt,
    };
    yield* claim.kind === "discount"
      ? tx
          .update(discountCodeRedemptions)
          .set(values)
          .where(
            and(
              eq(discountCodeRedemptions.paymentAttemptId, paymentAttemptId),
              eq(discountCodeRedemptions.state, "reserved")
            )
          )
      : tx
          .update(voucherRedemptions)
          .set(values)
          .where(
            and(
              eq(voucherRedemptions.paymentAttemptId, paymentAttemptId),
              eq(voucherRedemptions.state, "reserved")
            )
          );
  }
);

const releaseCodeClaim = Effect.fn("PaymentLifecycle.releaseCodeClaim")(
  function* (
    tx: TransactionClient,
    paymentAttemptId: PaymentAttemptId,
    releasedAt: Temporal.Instant,
    releaseReason: string
  ) {
    const [discountClaims, voucherClaims] = yield* Effect.all([
      tx
        .select({
          id: discountCodeRedemptions.codeId,
          state: discountCodeRedemptions.state,
        })
        .from(discountCodeRedemptions)
        .where(eq(discountCodeRedemptions.paymentAttemptId, paymentAttemptId))
        .limit(1)
        .for("update"),
      tx
        .select({
          id: voucherRedemptions.voucherId,
          state: voucherRedemptions.state,
        })
        .from(voucherRedemptions)
        .where(eq(voucherRedemptions.paymentAttemptId, paymentAttemptId))
        .limit(1)
        .for("update"),
    ]);
    const claim = selectStoredPromotionClaim(
      discountClaims[0],
      voucherClaims[0]
    );

    if (!claim) return;
    if (claim.state === "redeemed") {
      return yield* new DiscountClaimError({
        operation: "release",
        reason: "claim_conflict",
        message: "A redeemed promotion claim cannot be released.",
        codeId: claim.id,
      });
    }
    if (claim.state === "released") return;

    const values = {
      state: "released" as const,
      releasedAt,
      releaseReason,
      updatedAt: releasedAt,
    };
    yield* claim.kind === "discount"
      ? tx
          .update(discountCodeRedemptions)
          .set(values)
          .where(
            and(
              eq(discountCodeRedemptions.paymentAttemptId, paymentAttemptId),
              eq(discountCodeRedemptions.state, "reserved")
            )
          )
      : tx
          .update(voucherRedemptions)
          .set(values)
          .where(
            and(
              eq(voucherRedemptions.paymentAttemptId, paymentAttemptId),
              eq(voucherRedemptions.state, "reserved")
            )
          );
  }
);

const selectStoredPromotionClaim = (
  discountClaim:
    | { readonly id: DiscountCodeId; readonly state: string }
    | undefined,
  voucherClaim: { readonly id: VoucherId; readonly state: string } | undefined
) => {
  if (discountClaim) return { kind: "discount", ...discountClaim } as const;
  if (voucherClaim) return { kind: "voucher", ...voucherClaim } as const;
  return undefined;
};

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
