import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import type {
  NexiOperationId,
  NexiOrderId,
  NexiWebhookEventId,
} from "@deskohub/nexi";
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import {
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Schema,
} from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase, WorkspaceTransaction } from "@/db/database.service";
import {
  accountingDocumentSnapshots,
  discountApplications,
  discountCodeRedemptions,
  discountCodes,
  discountProductTargets,
  discounts,
  type PaymentAttemptState,
  paymentAttempts,
  promotionCodeCustomers,
  promotionCodes,
  referralAttributions,
  referralInvitationClaims,
  voucherRedemptions,
  vouchers,
  type WorkspaceReservationRow,
  workspaceReservations,
} from "@/db/schema";
import {
  type DatabaseQueryError,
  findViolatedConstraint,
} from "@/db/sql-constraint";
import { postgresUuidV7 } from "@/db/uuid-v7";
import { WorkspaceLocks } from "@/db/workspace-locks";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
  encodeStoredAccountingDocumentSnapshot,
  getAccountingDocumentSnapshotFirstServiceDate,
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
import { getWorkspaceProductKey } from "@/features/checkout/product-identity";
import {
  type DiscountCommitment,
  getDiscountCommitmentPayload,
} from "@/features/discounts/commitment";
import type { AppliedDiscount } from "@/features/discounts/contracts";
import { decodeDiscountDefinition } from "@/features/discounts/discount-definition";
import { discountLabelFor } from "@/features/discounts/discount-label";
import { DiscountClaimError } from "@/features/discounts/errors";
import type {
  DiscountApplicationId,
  DiscountCodeId,
  PromotionCodeId,
  VoucherId,
} from "@/features/discounts/persistence-contracts";
import { getWorkspaceProductTargetsCovering } from "@/features/discounts/product-target";
import { getPromotionTiming } from "@/features/discounts/promotion-code";
import type { DiscountClaimInstruction } from "@/features/discounts/provider";
import { isFirstServiceDateEligible } from "@/features/discounts/service-date-eligibility";
import type { Locale } from "@/features/i18n";
import { evaluateReferralAttribution } from "@/features/referrals/attribution";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  type Money,
  moneyEquals,
  moneyWithValue,
  sameMoneyUnit,
} from "@/shared/money/money";
import {
  type PaymentAttempt,
  toPaymentAttempt,
} from "./payment-attempt.repository";
import {
  discountAdjustmentsEqual,
  isAttributedToAnotherReferral,
  promotionTimingChanged,
  referralInvitationBenefitChanged,
  voucherCreditChanged,
  voucherPresentationChanged,
} from "./payment-claim-benefits";

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

interface PaymentLifecycleTransition {
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

export const administrationForcedPaymentCancellationFailureCode =
  "admin_forced_payment_cancellation";

export interface IPaymentLifecycleRepository {
  readonly createPendingNexiAttempt: (input: {
    readonly workspaceReservationId: WorkspaceReservationId;
    readonly providerOrderId: NexiOrderId;
    readonly amount: Money;
    readonly commitment: DiscountCommitment;
    readonly locale: Locale;
    readonly accountingSnapshot: AccountingDocumentSnapshot;
  }) => Effect.Effect<PaymentAttempt, PaymentLifecycleRepositoryError>;
  readonly completeInternalPayment: (input: {
    readonly workspaceReservationId: WorkspaceReservationId;
    readonly amount: Money;
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
    /**
     * Non-terminal attempt states the transition may start from; defaults to
     * both. Pass `["created"]` to end an attempt only while no provider
     * session has been attached to it.
     */
    readonly fromAttemptStates?: readonly NonTerminalPaymentAttemptState[];
  }) => Effect.Effect<
    PaymentLifecycleTransition,
    PaymentLifecycleRepositoryError
  >;
}

type NonTerminalPaymentAttemptState = Extract<
  PaymentAttemptState,
  "created" | "pending"
>;

export class PaymentLifecycleRepository extends Context.Service<
  PaymentLifecycleRepository,
  IPaymentLifecycleRepository
>()("@deskohub-workspace/checkout/PaymentLifecycleRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;
      const accountingSnapshotKeys = yield* AccountingSnapshotKeyService;

      const createPendingNexiAttempt = Effect.fn(
        "PaymentLifecycleRepository.createPendingNexiAttempt"
      )(function* (input: {
        readonly workspaceReservationId: WorkspaceReservationId;
        readonly providerOrderId: NexiOrderId;
        readonly amount: Money;
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
        const claimedApplications =
          yield* validateDiscountCommitment(commitment);
        const firstServiceDate = yield* validateCommitmentFirstServiceDate(
          commitment,
          accountingSnapshot
        );

        return yield* transaction(
          Effect.gen(function* () {
            const dotyposCustomerId = yield* findPaymentReservationCustomer(
              "createPendingNexiAttempt",
              input.workspaceReservationId
            );
            yield* WorkspaceLocks.referralFirstBooking(dotyposCustomerId);

            const [reservation] = yield* db
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

            yield* validateFirstBookingPaymentAdmission({
              dotyposCustomerId: reservation.dotyposCustomerId,
              workspaceReservationId: input.workspaceReservationId,
              hasReferralClaim: claimedApplications.referral !== undefined,
              operation: "createPendingNexiAttempt",
            });

            yield* validateAccountingDocumentSnapshotProviderIdentity({
              snapshot: accountingSnapshot,
              paymentReference: {
                type: "providerOrderId",
                id: input.providerOrderId,
              },
              dotyposCustomerId: reservation.dotyposCustomerId,
              dotyposReservationId: reservation.dotyposReservationId,
            });

            const [attemptRow] = yield* db
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
              paymentAttemptId: attemptRow.id,
              workspaceReservationId: input.workspaceReservationId,
              snapshot: accountingSnapshot,
              key: accountingSnapshotKey,
            });

            const [linked] = yield* db
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
              commitment,
              paymentAttemptId: attemptRow.id,
              workspaceReservationId: input.workspaceReservationId,
            });
            yield* reserveCommittedClaims({
              claimedApplications,
              applicationRows,
              paymentAttemptId: attemptRow.id,
              workspaceReservationId: input.workspaceReservationId,
              locale: input.locale,
              reservationCustomerId: reservation.dotyposCustomerId,
              reservationExpiresAt: reservation.reservationHoldExpiresAt,
              firstServiceDate,
            });

            return toPaymentAttempt(attemptRow);
          })
        ).pipe(
          Effect.catchTags({
            EffectDrizzleQueryError: failActiveClaimConflict,
            SqlError: failActiveClaimConflict,
          })
        );
      });

      const completeInternalPayment = Effect.fn(
        "PaymentLifecycleRepository.completeInternalPayment"
      )(function* (input: {
        readonly workspaceReservationId: WorkspaceReservationId;
        readonly amount: Money;
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
        const claimedApplications = yield* validateInternalPaymentCommitment(
          commitment,
          input.amount
        );
        const firstServiceDate = yield* validateCommitmentFirstServiceDate(
          commitment,
          accountingSnapshot
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

        return yield* transaction(
          Effect.gen(function* () {
            const dotyposCustomerId = yield* findPaymentReservationCustomer(
              "completeInternalPayment",
              input.workspaceReservationId
            );
            if (claimedApplications.referral !== undefined) {
              // A signed-in checkout completes an internal payment inside
              // the account guard, whose account lock is held on another
              // connection. acceptReferral takes the graph lock before
              // account locks, so an unbounded wait here could hang both; a
              // bounded one fails this payment instead and the customer
              // retries. The bound also allows the out-of-order graph lock
              // under that section. A guest payment has no section and
              // waits within the same bound.
              yield* WorkspaceLocks.referralGraph({
                boundedWait: Duration.seconds(5),
              });
            }
            yield* WorkspaceLocks.referralFirstBooking(dotyposCustomerId);

            const [reservation] = yield* db
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
              .where(eq(workspaceReservations.id, input.workspaceReservationId))
              .limit(1)
              .for("update");

            const paidAt = Temporal.Now.instant();

            const completed = yield* findCompletedInternalPayment(
              input,
              reservation
            );
            if (completed) return completed;

            if (!isCurrentUnpaidHold(reservation, paidAt)) {
              return yield* lifecycleStateError(
                "completeInternalPayment",
                {
                  type: "workspaceReservationId",
                  id: input.workspaceReservationId,
                },
                "Internal payments can only complete a current held unpaid reservation."
              );
            }

            yield* validateFirstBookingPaymentAdmission({
              dotyposCustomerId: reservation.dotyposCustomerId,
              workspaceReservationId: input.workspaceReservationId,
              hasReferralClaim: claimedApplications.referral !== undefined,
              operation: "completeInternalPayment",
            });

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

            const [attemptRow] = yield* db
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
              paymentAttemptId: attemptRow.id,
              workspaceReservationId: input.workspaceReservationId,
              snapshot: accountingSnapshot,
              key: accountingSnapshotKey,
            });

            const [completedReservation] = yield* db
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
              commitment,
              paymentAttemptId: attemptRow.id,
              workspaceReservationId: input.workspaceReservationId,
            });
            const claimedAt = yield* reserveCommittedClaims({
              claimedApplications,
              applicationRows,
              paymentAttemptId: attemptRow.id,
              workspaceReservationId: input.workspaceReservationId,
              locale: input.locale,
              reservationCustomerId: reservation.dotyposCustomerId,
              reservationExpiresAt: reservation.reservationHoldExpiresAt,
              firstServiceDate,
            });
            yield* redeemInternalPaymentClaims({
              paymentAttemptId: attemptRow.id,
              workspaceReservationId: input.workspaceReservationId,
              claimedAt,
            });

            return {
              attempt: toPaymentAttempt(attemptRow),
              changed: true,
              timestamp: paidAt,
            };
          })
        ).pipe(
          Effect.catchTags({
            EffectDrizzleQueryError: failActiveClaimConflict,
            SqlError: failActiveClaimConflict,
          })
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
            securityToken: input.securityToken,
            providerRedirectUrl: input.providerRedirectUrl,
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
          return yield* transaction(
            Effect.gen(function* () {
              const dotyposCustomerId = yield* findPaymentReservationCustomer(
                "markPaid",
                input.workspaceReservationId
              );
              // A transition that may record a referral attribution takes the
              // graph lock first, matching acceptReferral's lock order.
              if (yield* attemptRecordsReferral(input.id)) {
                yield* WorkspaceLocks.referralGraph();
              }
              yield* WorkspaceLocks.referralFirstBooking(dotyposCustomerId);
              yield* ensureReferralFirstPaidTransition({
                dotyposCustomerId,
                workspaceReservationId: input.workspaceReservationId,
                paymentAttemptId: input.id,
              });

              const [attempt] = yield* db
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

              const [reservation] = yield* db
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
                yield* redeemCodeClaim(input.id, input.paidAt);
                yield* redeemReferralInvitationClaim(
                  input.id,
                  input.workspaceReservationId,
                  input.paidAt
                );
                return {
                  attempt: toPaymentAttempt(attempt),
                  changed: true,
                  timestamp: reservation.paidAt ?? input.paidAt,
                };
              }

              const [consistent] = yield* db
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

              yield* redeemCodeClaim(input.id, input.paidAt);
              yield* redeemReferralInvitationClaim(
                input.id,
                input.workspaceReservationId,
                input.paidAt
              );
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
          readonly fromAttemptStates?: readonly NonTerminalPaymentAttemptState[];
        }) {
          const terminalAt = Temporal.Now.instant();
          const fromAttemptStates = input.fromAttemptStates ?? [
            "created",
            "pending",
          ];

          return yield* transaction(
            Effect.gen(function* () {
              const dotyposCustomerId = yield* findPaymentReservationCustomer(
                "markTerminal",
                input.workspaceReservationId
              );
              yield* WorkspaceLocks.referralFirstBooking(dotyposCustomerId);

              const [attempt] = yield* db
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
                      ...fromAttemptStates,
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

              const [reservation] = yield* db
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
                  input.id,
                  terminalAt,
                  input.failureCode
                );
                yield* releaseReferralInvitationClaim(
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

              const [consistent] = yield* db
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

              yield* releaseCodeClaim(input.id, terminalAt, input.failureCode);
              yield* releaseReferralInvitationClaim(
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
    }).pipe(Effect.provide(AccountingSnapshotKeyService.Default))
  );
}

/** Reads the reservation's customer, whose first-booking lock comes next. */
const findPaymentReservationCustomer = Effect.fnUntraced(function* (
  operation:
    | "createPendingNexiAttempt"
    | "completeInternalPayment"
    | "markPaid"
    | "markTerminal",
  workspaceReservationId: WorkspaceReservationId
) {
  const { db } = yield* WorkspaceTransaction;
  const [reservationIdentity] = yield* db
    .select({
      dotyposCustomerId: workspaceReservations.dotyposCustomerId,
    })
    .from(workspaceReservations)
    .where(eq(workspaceReservations.id, workspaceReservationId))
    .limit(1);
  if (!reservationIdentity) {
    return yield* lifecycleStateError(
      operation,
      {
        type: "workspaceReservationId",
        id: workspaceReservationId,
      },
      "The payment reservation was not found."
    );
  }
  return reservationIdentity.dotyposCustomerId;
});

/**
 * The internal payment that already completed the reservation for this
 * amount, which a repeated completion returns unchanged.
 */
const findCompletedInternalPayment = Effect.fnUntraced(function* (
  input: {
    readonly workspaceReservationId: WorkspaceReservationId;
    readonly amount: Money;
  },
  reservation:
    | Pick<
        WorkspaceReservationRow,
        "paymentState" | "activePaymentAttemptId" | "paidAt"
      >
    | undefined
) {
  const { db } = yield* WorkspaceTransaction;
  if (
    !(
      reservation?.paymentState === "paid" && reservation.activePaymentAttemptId
    )
  ) {
    return undefined;
  }
  const [existingAttempt] = yield* db
    .select()
    .from(paymentAttempts)
    .where(
      and(
        eq(paymentAttempts.id, reservation.activePaymentAttemptId),
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
    !existingAttempt ||
    !moneyEquals(toPaymentAttempt(existingAttempt).amount, input.amount)
  ) {
    return undefined;
  }
  return {
    attempt: toPaymentAttempt(existingAttempt),
    changed: false,
    timestamp: reservation.paidAt ?? existingAttempt.updatedAt,
  } satisfies PaymentLifecycleTransition;
});

/** Whether an internal payment may complete the reservation at `at`. */
const isCurrentUnpaidHold = <
  Reservation extends Pick<
    WorkspaceReservationRow,
    "reservationState" | "reservationHoldExpiresAt" | "paymentState"
  >,
>(
  reservation: Reservation | undefined,
  at: Temporal.Instant
): reservation is Reservation & {
  readonly reservationHoldExpiresAt: Temporal.Instant;
} =>
  reservation?.reservationState === "held" &&
  reservation.reservationHoldExpiresAt !== null &&
  Temporal.Instant.compare(reservation.reservationHoldExpiresAt, at) > 0 &&
  ["not_started", "failed", "cancelled", "expired"].includes(
    reservation.paymentState
  );

/** Redeems the claims an internal payment reserved in its transaction. */
const redeemInternalPaymentClaims = Effect.fnUntraced(function* (input: {
  readonly paymentAttemptId: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly claimedAt: {
    readonly code: Temporal.Instant | undefined;
    readonly referral: Temporal.Instant | undefined;
  };
}) {
  if (input.claimedAt.code) {
    yield* redeemCodeClaim(input.paymentAttemptId, input.claimedAt.code);
  }
  if (input.claimedAt.referral) {
    yield* redeemReferralInvitationClaim(
      input.paymentAttemptId,
      input.workspaceReservationId,
      input.claimedAt.referral
    );
  }
});

type CommitmentPayload = ReturnType<typeof getDiscountCommitmentPayload>;

export const validateDiscountCommitment = Effect.fn(
  "PaymentLifecycle.validateDiscountCommitment"
)(function* (commitment: CommitmentPayload) {
  let codeClaimedApplication: OrdinaryClaimedApplication | undefined;
  let referralClaimedApplication: ReferralClaimedApplication | undefined;

  for (const [
    index,
    { application, claim },
  ] of commitment.applications.entries()) {
    yield* requireConsistentApplicationMoney(application, claim);

    if (claim?.kind === "referral_invitation") {
      yield* requireNoEarlierClaim(
        referralClaimedApplication,
        "A payment attempt can reserve one referral invitation claim.",
        claim
      );
      referralClaimedApplication = { index, application, claim };
    } else if (claim) {
      yield* requireNoEarlierClaim(
        codeClaimedApplication,
        "A payment attempt can reserve one ordinary promotion claim.",
        claim
      );
      codeClaimedApplication = { index, application, claim };
    }

    yield* requireClaimedProduct(claim, commitment.product);
  }

  return {
    code: codeClaimedApplication,
    referral: referralClaimedApplication,
  };
});

/** An application takes its amount from its subtotal, in the subtotal's unit. */
const requireConsistentApplicationMoney = (
  application: AppliedDiscount,
  claim: DiscountClaimInstruction | undefined
): Effect.Effect<void, DiscountClaimError> => {
  const amountInSubtotalUnit = moneyWithValue(
    application.amount.value,
    application.subtotalBefore
  );
  const expectedSubtotalAfter = moneyWithValue(
    application.subtotalBefore.value - application.amount.value,
    application.subtotalBefore
  );
  return moneyEquals(amountInSubtotalUnit, application.amount) &&
    moneyEquals(expectedSubtotalAfter, application.subtotalAfter)
    ? Effect.void
    : Effect.fail(
        new DiscountClaimError({
          operation: "reserve",
          reason: "money_mismatch",
          message: "A committed discount application has inconsistent money.",
          codeId: getPromotionClaimId(claim),
        })
      );
};

/** A commitment carries at most one claim of each ledger. */
const requireNoEarlierClaim = (
  earlier: ClaimedApplication<DiscountClaimInstruction> | undefined,
  message: string,
  claim: DiscountClaimInstruction
): Effect.Effect<void, DiscountClaimError> =>
  earlier
    ? Effect.fail(claimError("reserve", "claim_conflict", message, claim))
    : Effect.void;

const requireClaimedProduct = (
  claim: DiscountClaimInstruction | undefined,
  product: CommitmentPayload["product"]
): Effect.Effect<void, DiscountClaimError> =>
  claim?.kind === "discount_code" &&
  getWorkspaceProductKey(claim.product) !== getWorkspaceProductKey(product)
    ? Effect.fail(
        claimError(
          "reserve",
          "product_ineligible",
          "The discount-code claim targets a different product.",
          claim
        )
      )
    : Effect.void;

/**
 * The commitment was affirmed for the reservation this attempt pays for, so
 * the code claim checks service dates against its start date.
 */
const validateCommitmentFirstServiceDate = Effect.fn(
  "PaymentLifecycle.validateCommitmentFirstServiceDate"
)(function* (
  commitment: CommitmentPayload,
  snapshot: AccountingDocumentSnapshot
) {
  const firstServiceDate =
    getAccountingDocumentSnapshotFirstServiceDate(snapshot);
  if (commitment.firstServiceDate !== firstServiceDate) {
    return yield* new DiscountClaimError({
      operation: "reserve",
      reason: "claim_conflict",
      message:
        "The discount commitment was affirmed for a different reservation start date.",
    });
  }
  return firstServiceDate;
});

export const validateInternalPaymentCommitment = Effect.fn(
  "PaymentLifecycle.validateInternalPaymentCommitment"
)(function* (commitment: CommitmentPayload, amount: Money) {
  const claimedApplication = yield* validateDiscountCommitment(commitment);
  const finalSubtotal =
    commitment.applications.at(-1)?.application.subtotalAfter;

  if (!finalSubtotal || !moneyEquals(finalSubtotal, amount)) {
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
    codeId: getPromotionClaimId(claim),
  });

const getPromotionClaimId = (claim: DiscountClaimInstruction | undefined) => {
  if (!claim) return undefined;
  return Match.value(claim).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount_code: ({ codeId }) => codeId,
      voucher: ({ voucherId }) => voucherId,
      referral_invitation: () => undefined,
    })
  );
};

/**
 * Whether the attempt reserved an invitation from a checkout referral, whose
 * attribution its paid transition records. Claim referral columns are
 * written once at admission, so this read is stable before any lock.
 */
export const attemptRecordsReferral = Effect.fn(
  "PaymentLifecycle.attemptRecordsReferral"
)(function* (paymentAttemptId: PaymentAttemptId) {
  const { db } = yield* WorkspaceTransaction;
  const [claim] = yield* db
    .select({
      referrerDotyposCustomerId:
        referralInvitationClaims.referrerDotyposCustomerId,
    })
    .from(referralInvitationClaims)
    .where(eq(referralInvitationClaims.paymentAttemptId, paymentAttemptId))
    .limit(1);
  return claim?.referrerDotyposCustomerId != null;
});

const findActiveInvitationClaim = (
  dotyposCustomerId: DotyposCustomerId,
  exceptPaymentAttemptId?: PaymentAttemptId
) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .select({ id: referralInvitationClaims.id })
      .from(referralInvitationClaims)
      .where(
        and(
          eq(
            referralInvitationClaims.invitedDotyposCustomerId,
            dotyposCustomerId
          ),
          inArray(referralInvitationClaims.state, ["reserved", "redeemed"]),
          exceptPaymentAttemptId === undefined
            ? undefined
            : ne(
                referralInvitationClaims.paymentAttemptId,
                exceptPaymentAttemptId
              )
        )
      )
      .limit(1)
      .pipe(Effect.map(([claim]) => claim))
  );

/**
 * A customer is invited once attributed or once a checkout referral holds
 * their invitation. An invited customer's first paid booking is admitted one
 * attempt at a time so an ordinary payment cannot race past the invitation.
 */
const validateFirstBookingPaymentAdmission = Effect.fn(
  "PaymentLifecycle.validateFirstBookingPaymentAdmission"
)(function* (input: {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly hasReferralClaim: boolean;
  readonly operation: "createPendingNexiAttempt" | "completeInternalPayment";
}) {
  const { db } = yield* WorkspaceTransaction;
  const [attribution] = yield* db
    .select({
      invitedDotyposCustomerId: referralAttributions.invitedDotyposCustomerId,
    })
    .from(referralAttributions)
    .where(
      eq(referralAttributions.invitedDotyposCustomerId, input.dotyposCustomerId)
    )
    .limit(1);
  const activeClaim = yield* findActiveInvitationClaim(input.dotyposCustomerId);

  if (!attribution && !activeClaim && !input.hasReferralClaim) return;

  const previousPayment = yield* findOtherReservationWithPayment(
    input.dotyposCustomerId,
    input.workspaceReservationId,
    "paid"
  );

  if (previousPayment) {
    if (input.hasReferralClaim) {
      return yield* new DiscountClaimError({
        operation: "reserve",
        reason: "claim_conflict",
        message:
          "Referral invitation is only available for a first paid booking.",
      });
    }
    return;
  }

  if (activeClaim) {
    return yield* firstPaymentAlreadyAdmitted(input);
  }

  const pendingPayment = yield* findOtherReservationWithPayment(
    input.dotyposCustomerId,
    input.workspaceReservationId,
    "pending"
  );
  if (pendingPayment) {
    return yield* firstPaymentAlreadyAdmitted(input);
  }
});

/**
 * Another payment of the invited customer holds their first booking: a
 * referral claim conflicts, an ordinary payment waits for that booking.
 */
const firstPaymentAlreadyAdmitted = (input: {
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly hasReferralClaim: boolean;
  readonly operation: "createPendingNexiAttempt" | "completeInternalPayment";
}): Effect.Effect<never, DiscountClaimError | PaymentLifecycleStateError> =>
  Effect.fail(
    input.hasReferralClaim
      ? new DiscountClaimError({
          operation: "reserve",
          reason: "claim_conflict",
          message: "Another payment already holds this referral invitation.",
        })
      : lifecycleStateError(
          input.operation,
          { type: "workspaceReservationId", id: input.workspaceReservationId },
          "An invited customer's first payment is already admitted."
        )
  );

/** Another of the customer's reservations in `paymentState`, if any. */
const findOtherReservationWithPayment = (
  dotyposCustomerId: DotyposCustomerId,
  workspaceReservationId: WorkspaceReservationId,
  paymentState: "paid" | "pending"
) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .select({ id: workspaceReservations.id })
      .from(workspaceReservations)
      .where(
        and(
          eq(workspaceReservations.dotyposCustomerId, dotyposCustomerId),
          eq(workspaceReservations.paymentState, paymentState),
          ne(workspaceReservations.id, workspaceReservationId)
        )
      )
      .limit(1)
      .pipe(Effect.map(([reservation]) => reservation))
  );

export const ensureReferralFirstPaidTransition = Effect.fn(
  "PaymentLifecycle.ensureReferralFirstPaidTransition"
)(function* (input: {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly paymentAttemptId: PaymentAttemptId;
}) {
  const { db } = yield* WorkspaceTransaction;
  const [claim] = yield* db
    .select({
      state: referralInvitationClaims.state,
      referrerDotyposCustomerId:
        referralInvitationClaims.referrerDotyposCustomerId,
    })
    .from(referralInvitationClaims)
    .where(
      eq(referralInvitationClaims.paymentAttemptId, input.paymentAttemptId)
    )
    .limit(1)
    .for("update");
  if (claim?.state === "redeemed") return;

  const [attribution] = yield* db
    .select({
      invitedDotyposCustomerId: referralAttributions.invitedDotyposCustomerId,
    })
    .from(referralAttributions)
    .where(
      eq(referralAttributions.invitedDotyposCustomerId, input.dotyposCustomerId)
    )
    .limit(1);
  const otherActiveClaim = yield* findActiveInvitationClaim(
    input.dotyposCustomerId,
    input.paymentAttemptId
  );
  if (isUninvitedBooking({ attribution, claim, otherActiveClaim })) return;
  if (claimLostItsAttribution(attribution, claim)) {
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "claim_conflict",
      message: "The accepted referral attribution is no longer available.",
    });
  }

  const previousPayment = yield* findOtherReservationWithPayment(
    input.dotyposCustomerId,
    input.workspaceReservationId,
    "paid"
  );
  if (previousPayment) {
    if (!claim) return;
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "claim_conflict",
      message:
        "Referral invitation is only available for a first paid booking.",
    });
  }

  yield* requireNoOtherAdmittedFirstBooking(input, otherActiveClaim);
});

type InviteeAttribution = Pick<
  typeof referralAttributions.$inferSelect,
  "invitedDotyposCustomerId"
>;
type AttemptInvitationClaim = Pick<
  typeof referralInvitationClaims.$inferSelect,
  "state" | "referrerDotyposCustomerId"
>;
type ActiveInvitationClaim = Pick<
  typeof referralInvitationClaims.$inferSelect,
  "id"
>;

/** Neither attributed nor holding an invitation: an ordinary booking. */
const isUninvitedBooking = (evidence: {
  readonly attribution: InviteeAttribution | undefined;
  readonly claim: AttemptInvitationClaim | undefined;
  readonly otherActiveClaim: ActiveInvitationClaim | undefined;
}) => !evidence.attribution && !evidence.claim && !evidence.otherActiveClaim;

/**
 * An older claim relied on an attribution accepted before payment; a
 * checkout referral claim records its own attribution when redeemed.
 */
const claimLostItsAttribution = (
  attribution: InviteeAttribution | undefined,
  claim: AttemptInvitationClaim | undefined
) =>
  !attribution &&
  claim !== undefined &&
  claim.referrerDotyposCustomerId === null;

const requireNoOtherAdmittedFirstBooking = Effect.fnUntraced(function* (
  input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly workspaceReservationId: WorkspaceReservationId;
  },
  otherActiveClaim: ActiveInvitationClaim | undefined
) {
  const otherPendingPayment = yield* findOtherReservationWithPayment(
    input.dotyposCustomerId,
    input.workspaceReservationId,
    "pending"
  );
  if (otherActiveClaim || otherPendingPayment) {
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "claim_conflict",
      message: "Another first booking is already admitted for this invitee.",
    });
  }
});

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
  readonly amount: Money;
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
    !moneyEquals(snapshot.quote.payment.expectedPrice, input.amount) ||
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
  const sameUnit = (amount: Money) =>
    sameMoneyUnit(amount, payment.expectedPrice);

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
  readonly paymentAttemptId: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly snapshot: AccountingDocumentSnapshot;
  readonly key: AccountingSnapshotKey;
}) {
  const { db } = yield* WorkspaceTransaction;
  const snapshotJson = JSON.stringify(
    encodeStoredAccountingDocumentSnapshot(input.snapshot)
  );

  yield* db
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

type ClaimedApplication<Claim extends DiscountClaimInstruction> = {
  readonly index: number;
  readonly application: AppliedDiscount;
  readonly claim: Claim;
};

type OrdinaryPromotionClaim = Exclude<
  DiscountClaimInstruction,
  { readonly kind: "referral_invitation" }
>;
type ReferralInvitationClaim = Extract<
  DiscountClaimInstruction,
  { readonly kind: "referral_invitation" }
>;
type OrdinaryClaimedApplication = ClaimedApplication<OrdinaryPromotionClaim>;
type ReferralClaimedApplication = ClaimedApplication<ReferralInvitationClaim>;

type ClaimedApplications = {
  readonly code: OrdinaryClaimedApplication | undefined;
  readonly referral: ReferralClaimedApplication | undefined;
};

type PersistedApplication = {
  readonly id: DiscountApplicationId;
  readonly sequence: number;
};

const persistDiscountApplications = Effect.fn(
  "PaymentLifecycle.persistDiscountApplications"
)(function* (input: {
  readonly commitment: CommitmentPayload;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId;
}) {
  const { db } = yield* WorkspaceTransaction;
  if (input.commitment.applications.length === 0) {
    return [] satisfies PersistedApplication[];
  }

  return yield* db
    .insert(discountApplications)
    .values(
      input.commitment.applications.map(
        ({ application, provenance }, sequence) => ({
          paymentAttemptId: input.paymentAttemptId,
          workspaceReservationId: input.workspaceReservationId,
          sequence,
          publicDiscountId: application.discount.id,
          label: application.discount.label,
          staffLabel: application.discount.staffLabel ?? null,
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

const reserveCommittedClaims = Effect.fn(
  "PaymentLifecycle.reserveCommittedClaims"
)(function* (input: {
  readonly claimedApplications: ClaimedApplications;
  readonly applicationRows: readonly PersistedApplication[];
  readonly paymentAttemptId: PaymentAttemptId;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly locale: Locale;
  readonly reservationCustomerId: DotyposCustomerId;
  readonly reservationExpiresAt: Temporal.Instant;
  readonly firstServiceDate: string;
}) {
  const findApplicationId = (
    claimed: ClaimedApplication<DiscountClaimInstruction>
  ) =>
    input.applicationRows.find(({ sequence }) => sequence === claimed.index)
      ?.id;

  let code: Temporal.Instant | undefined;
  if (input.claimedApplications.code) {
    const claimed = input.claimedApplications.code;
    const applicationId = findApplicationId(claimed);
    if (!applicationId) {
      return yield* claimError(
        "reserve",
        "claim_conflict",
        "The claimed discount application was not persisted.",
        claimed.claim
      );
    }
    code = yield* reserveCodeClaim({
      claim: claimed.claim,
      application: claimed.application,
      applicationId,
      paymentAttemptId: input.paymentAttemptId,
      locale: input.locale,
      reservationCustomerId: input.reservationCustomerId,
      reservationExpiresAt: input.reservationExpiresAt,
      firstServiceDate: input.firstServiceDate,
    });
  }

  let referral: Temporal.Instant | undefined;
  if (input.claimedApplications.referral) {
    const claimed = input.claimedApplications.referral;
    const applicationId = findApplicationId(claimed);
    if (!applicationId) {
      return yield* claimError(
        "reserve",
        "claim_conflict",
        "The referral application was not persisted.",
        claimed.claim
      );
    }
    referral = yield* reserveReferralInvitationClaim({
      claim: claimed.claim,
      application: claimed.application,
      applicationId,
      paymentAttemptId: input.paymentAttemptId,
      reservationCustomerId: input.reservationCustomerId,
      reservationExpiresAt: input.reservationExpiresAt,
      locale: input.locale,
    });
  }

  return { code, referral };
});

const reserveReferralInvitationClaim = Effect.fn(
  "PaymentLifecycle.reserveReferralInvitationClaim"
)(function* (input: {
  readonly claim: ReferralInvitationClaim;
  readonly application: AppliedDiscount;
  readonly applicationId: DiscountApplicationId;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly reservationCustomerId: DotyposCustomerId;
  readonly reservationExpiresAt: Temporal.Instant;
  readonly locale: Locale;
}) {
  const { db } = yield* WorkspaceTransaction;
  if (input.reservationCustomerId !== input.claim.invitedDotyposCustomerId) {
    return yield* claimError(
      "reserve",
      "customer_ineligible",
      "The referral invitation customer does not match the reservation.",
      input.claim
    );
  }

  // The first-booking lock serializes this with acceptReferral, so an
  // attribution recorded since pricing is seen here.
  const [attribution] = yield* db
    .select({
      referrerDotyposCustomerId: referralAttributions.referrerDotyposCustomerId,
      promotionCodeId: referralAttributions.promotionCodeId,
    })
    .from(referralAttributions)
    .where(
      eq(
        referralAttributions.invitedDotyposCustomerId,
        input.claim.invitedDotyposCustomerId
      )
    )
    .limit(1)
    .for("update");
  if (isAttributedToAnotherReferral(attribution, input.claim)) {
    return yield* claimError(
      "reserve",
      "claim_conflict",
      "The customer is attributed to a different referral.",
      input.claim
    );
  }

  if (referralInvitationBenefitChanged(input)) {
    return yield* claimError(
      "reserve",
      "claim_conflict",
      "The accepted referral invitation benefit changed before payment.",
      input.claim
    );
  }

  const reservedAt = Temporal.Now.instant();
  if (Temporal.Instant.compare(input.reservationExpiresAt, reservedAt) <= 0) {
    return yield* lifecycleStateError(
      "reserveReferralInvitationClaim",
      { type: "paymentAttemptId", id: input.paymentAttemptId },
      "Referral claims can only be reserved for a current held reservation."
    );
  }

  yield* db.insert(referralInvitationClaims).values({
    invitedDotyposCustomerId: input.claim.invitedDotyposCustomerId,
    referrerDotyposCustomerId: input.claim.referrerDotyposCustomerId,
    promotionCodeId: input.claim.promotionCodeId,
    applicationId: input.applicationId,
    paymentAttemptId: input.paymentAttemptId,
    state: "reserved",
    reservationExpiresAt: input.reservationExpiresAt,
    reservedAt,
    updatedAt: reservedAt,
  });
  return reservedAt;
});

const reserveCodeClaim = Effect.fn("PaymentLifecycle.reserveCodeClaim")(
  function* (input: {
    readonly claim: OrdinaryPromotionClaim;
    readonly application: AppliedDiscount;
    readonly applicationId: DiscountApplicationId;
    readonly paymentAttemptId: PaymentAttemptId;
    readonly locale: Locale;
    readonly reservationCustomerId: DotyposCustomerId;
    readonly reservationExpiresAt: Temporal.Instant;
    readonly firstServiceDate: string;
  }) {
    if (input.reservationCustomerId !== input.claim.dotyposCustomerId) {
      return yield* claimError(
        "reserve",
        "customer_ineligible",
        "The discount-code claim customer does not match the reservation.",
        input.claim
      );
    }

    const stored = yield* requireEnabledPromotion(
      yield* lockClaimedPromotion(input.claim),
      input.claim
    );

    const claimedAt = Temporal.Now.instant();
    yield* requirePromotionWindow(input, stored.promotion, claimedAt);
    yield* requireServiceDateEligible(stored, input.firstServiceDate);
    yield* requireAllowlistedCustomer(stored.promotion.id, input.claim);

    yield* Match.value(stored).pipe(
      Match.discriminatorsExhaustive("kind")({
        discount_code: ({ claim, code, promotion }) =>
          validateStoredDiscountClaim({
            ...input,
            claim,
            code,
            promotion,
          }),
        voucher: ({ claim, voucher, promotion }) =>
          validateVoucherClaim({
            ...input,
            claim,
            voucher,
            promotion,
          }),
      })
    );

    yield* Match.value(stored).pipe(
      Match.discriminatorsExhaustive("kind")({
        discount_code: ({ code }) =>
          requireDiscountCodeUsesRemaining(code, input.claim),
        voucher: ({ voucher }) =>
          requireNoActiveVoucherClaim(voucher, input.claim),
      })
    );

    yield* insertPromotionClaim(stored, {
      applicationId: input.applicationId,
      paymentAttemptId: input.paymentAttemptId,
      dotyposCustomerId: input.claim.dotyposCustomerId,
      state: "reserved" as const,
      reservationExpiresAt: input.reservationExpiresAt,
      reservedAt: claimedAt,
      updatedAt: claimedAt,
    });
    return claimedAt;
  }
);

type StoredPromotion =
  | {
      readonly kind: "discount_code";
      readonly claim: Extract<
        OrdinaryPromotionClaim,
        { readonly kind: "discount_code" }
      >;
      readonly promotion: typeof promotionCodes.$inferSelect;
      readonly code: typeof discountCodes.$inferSelect;
    }
  | {
      readonly kind: "voucher";
      readonly claim: Extract<
        OrdinaryPromotionClaim,
        { readonly kind: "voucher" }
      >;
      readonly promotion: typeof promotionCodes.$inferSelect;
      readonly voucher: typeof vouchers.$inferSelect;
    };

/** Locks the claimed code or voucher with its promotion. */
const lockClaimedPromotion = Effect.fnUntraced(function* (
  claim: OrdinaryPromotionClaim
) {
  const { db } = yield* WorkspaceTransaction;
  return yield* Match.value(claim).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount_code: Effect.fn(function* (claim) {
        const rows = yield* db
          .select({ promotion: promotionCodes, code: discountCodes })
          .from(discountCodes)
          .innerJoin(
            promotionCodes,
            eq(promotionCodes.id, discountCodes.promotionCodeId)
          )
          .where(eq(discountCodes.id, claim.codeId))
          .limit(1)
          .for("update");
        return rows[0]
          ? ({ kind: "discount_code", claim, ...rows[0] } as const)
          : undefined;
      }),
      voucher: Effect.fn(function* (claim) {
        const rows = yield* db
          .select({ promotion: promotionCodes, voucher: vouchers })
          .from(vouchers)
          .innerJoin(
            promotionCodes,
            eq(promotionCodes.id, vouchers.promotionCodeId)
          )
          .where(eq(vouchers.id, claim.voucherId))
          .limit(1)
          .for("update");
        return rows[0]
          ? ({ kind: "voucher", claim, ...rows[0] } as const)
          : undefined;
      }),
    })
  );
});

/** The claimed promotion still exists, grants the accepted benefit, and is on. */
const requireEnabledPromotion = (
  stored: StoredPromotion | undefined,
  claim: OrdinaryPromotionClaim
): Effect.Effect<StoredPromotion, DiscountClaimError> => {
  if (
    !stored ||
    (stored.kind === "discount_code" &&
      stored.code.discountId !== stored.claim.storedDiscountId)
  ) {
    return Effect.fail(
      claimError(
        "reserve",
        "unknown_code",
        "The accepted promotion no longer exists.",
        claim
      )
    );
  }
  if (!stored.promotion.enabled) {
    return Effect.fail(
      claimError(
        "reserve",
        "inactive",
        "The accepted promotion is inactive.",
        claim
      )
    );
  }
  return Effect.succeed(stored);
};

/** The hold and the promotion are both current when the claim is made. */
/** A discount code's current service dates still cover the reservation. */
const requireServiceDateEligible = (
  stored: StoredPromotion,
  firstServiceDate: string
): Effect.Effect<void, DiscountClaimError> =>
  stored.kind === "discount_code" &&
  !isFirstServiceDateEligible(stored.code, firstServiceDate)
    ? Effect.fail(
        claimError(
          "reserve",
          "service_date_ineligible",
          "The accepted discount code no longer covers the reservation start date.",
          stored.claim
        )
      )
    : Effect.void;

const requirePromotionWindow = (
  input: {
    readonly claim: OrdinaryPromotionClaim;
    readonly paymentAttemptId: PaymentAttemptId;
    readonly reservationExpiresAt: Temporal.Instant;
  },
  promotion: typeof promotionCodes.$inferSelect,
  claimedAt: Temporal.Instant
): Effect.Effect<void, DiscountClaimError | PaymentLifecycleStateError> => {
  if (Temporal.Instant.compare(input.reservationExpiresAt, claimedAt) <= 0) {
    return Effect.fail(
      lifecycleStateError(
        "reserveCodeClaim",
        { type: "paymentAttemptId", id: input.paymentAttemptId },
        "Discount claims can only be reserved for a current held reservation."
      )
    );
  }
  if (
    promotion.validFrom &&
    Temporal.Instant.compare(claimedAt, promotion.validFrom) < 0
  ) {
    return Effect.fail(
      claimError(
        "reserve",
        "not_started",
        "The accepted promotion is not valid yet.",
        input.claim
      )
    );
  }
  if (
    promotion.validUntil &&
    Temporal.Instant.compare(claimedAt, promotion.validUntil) >= 0
  ) {
    return Effect.fail(
      claimError(
        "reserve",
        "expired",
        "The accepted promotion has expired.",
        input.claim
      )
    );
  }
  return Effect.void;
};

/** A promotion with an allowlist admits only the customers on it. */
const requireAllowlistedCustomer = Effect.fnUntraced(function* (
  promotionId: (typeof promotionCodes.$inferSelect)["id"],
  claim: OrdinaryPromotionClaim
) {
  const { db } = yield* WorkspaceTransaction;
  const [allowlist] = yield* db
    .select({ count: count() })
    .from(promotionCodeCustomers)
    .where(eq(promotionCodeCustomers.promotionCodeId, promotionId));
  if ((allowlist?.count ?? 0) > 0) {
    const [customer] = yield* db
      .select({ promotionCodeId: promotionCodeCustomers.promotionCodeId })
      .from(promotionCodeCustomers)
      .where(
        and(
          eq(promotionCodeCustomers.promotionCodeId, promotionId),
          eq(promotionCodeCustomers.dotyposCustomerId, claim.dotyposCustomerId)
        )
      )
      .limit(1);
    if (!customer) {
      return yield* claimError(
        "reserve",
        "customer_ineligible",
        "The customer is no longer eligible for the accepted promotion.",
        claim
      );
    }
  }
});

/** The customer's and then every customer's active uses stay within limits. */
const requireDiscountCodeUsesRemaining = Effect.fnUntraced(function* (
  code: typeof discountCodes.$inferSelect,
  claim: OrdinaryPromotionClaim
) {
  const { db } = yield* WorkspaceTransaction;
  const [customerUses] = yield* db
    .select({ count: count() })
    .from(discountCodeRedemptions)
    .where(
      and(
        eq(discountCodeRedemptions.codeId, code.id),
        eq(discountCodeRedemptions.dotyposCustomerId, claim.dotyposCustomerId),
        inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
      )
    );
  if (
    code.maxUsesPerCustomer !== null &&
    (customerUses?.count ?? 0) >= code.maxUsesPerCustomer
  ) {
    return yield* claimError(
      "reserve",
      "usage_limit_reached",
      "The customer has no remaining uses for this discount code.",
      claim
    );
  }
  yield* requireDiscountCodeTotalUsesRemaining(code, claim);
});

const requireDiscountCodeTotalUsesRemaining = Effect.fnUntraced(function* (
  code: typeof discountCodes.$inferSelect,
  claim: OrdinaryPromotionClaim
) {
  if (code.maxUses === null) return;
  const { db } = yield* WorkspaceTransaction;
  const [uses] = yield* db
    .select({ count: count() })
    .from(discountCodeRedemptions)
    .where(
      and(
        eq(discountCodeRedemptions.codeId, code.id),
        inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
      )
    );

  if ((uses?.count ?? 0) >= code.maxUses) {
    return yield* claimError(
      "reserve",
      "usage_limit_reached",
      "The accepted discount code has no remaining uses.",
      claim
    );
  }
});

/** A customer holds at most one reserved claim on a voucher. */
const requireNoActiveVoucherClaim = Effect.fnUntraced(function* (
  voucher: typeof vouchers.$inferSelect,
  claim: OrdinaryPromotionClaim
) {
  const { db } = yield* WorkspaceTransaction;
  const [customerUse] = yield* db
    .select({ state: voucherRedemptions.state })
    .from(voucherRedemptions)
    .where(
      and(
        eq(voucherRedemptions.voucherId, voucher.id),
        eq(voucherRedemptions.dotyposCustomerId, claim.dotyposCustomerId),
        eq(voucherRedemptions.state, "reserved")
      )
    )
    .limit(1);
  if (customerUse) {
    return yield* claimError(
      "reserve",
      "claim_conflict",
      "The customer already has an active claim for this voucher.",
      claim
    );
  }
});

const insertPromotionClaim = Effect.fnUntraced(function* (
  stored: StoredPromotion,
  claimValues: {
    readonly applicationId: DiscountApplicationId;
    readonly paymentAttemptId: PaymentAttemptId;
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly state: "reserved";
    readonly reservationExpiresAt: Temporal.Instant;
    readonly reservedAt: Temporal.Instant;
    readonly updatedAt: Temporal.Instant;
  }
) {
  const { db } = yield* WorkspaceTransaction;
  yield* Match.value(stored).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount_code: ({ code }) =>
        db
          .insert(discountCodeRedemptions)
          .values({
            ...claimValues,
            codeId: code.id,
          })
          .pipe(Effect.asVoid),
      voucher: ({ voucher }) =>
        db
          .insert(voucherRedemptions)
          .values({
            ...claimValues,
            voucherId: voucher.id,
          })
          .pipe(Effect.asVoid),
    })
  );
});

const validateStoredDiscountClaim = Effect.fn(
  "PaymentLifecycle.validateStoredDiscountClaim"
)(function* (input: {
  readonly claim: Extract<
    DiscountClaimInstruction,
    { readonly kind: "discount_code" }
  >;
  readonly code: typeof discountCodes.$inferSelect;
  readonly promotion: typeof promotionCodes.$inferSelect;
  readonly application: AppliedDiscount;
  readonly locale: Locale;
}) {
  const { db } = yield* WorkspaceTransaction;
  const [definition] = yield* db
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

  const [target] = yield* db
    .select({
      discountId: discountProductTargets.discountId,
      productTarget: discountProductTargets.productTarget,
    })
    .from(discountProductTargets)
    .where(
      and(
        eq(discountProductTargets.discountId, input.claim.storedDiscountId),
        inArray(discountProductTargets.productTarget, [
          ...getWorkspaceProductTargetsCovering(input.claim.product),
        ])
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
          productTarget: target.productTarget,
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
    discountLabelFor(currentDefinition.labels, input.locale) !==
      input.application.discount.label ||
    promotionTimingChanged(timing, input.application.discount)
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
    readonly claim: Extract<
      DiscountClaimInstruction,
      { readonly kind: "voucher" }
    >;
    readonly voucher: typeof vouchers.$inferSelect;
    readonly promotion: typeof promotionCodes.$inferSelect;
    readonly application: AppliedDiscount;
    readonly locale: Locale;
  }) {
    const { db } = yield* WorkspaceTransaction;
    const [usage] = yield* db
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
    const timing = getPromotionTiming(input.promotion.validUntil);
    if (
      voucherCreditChanged({ ...input, availableAmount }) ||
      voucherPresentationChanged({ ...input, timing })
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

export const redeemCodeClaim = Effect.fn("PaymentLifecycle.redeemCodeClaim")(
  function* (
    paymentAttemptId: PaymentAttemptId,
    redeemedAt: Temporal.Instant,
    allowReleased = false
  ) {
    const claim = yield* lockAttemptPromotionClaim(paymentAttemptId);

    if (!claim) return;
    if (claim.state === "released" && !allowReleased) {
      return yield* new DiscountClaimError({
        operation: "redeem",
        reason: "claim_conflict",
        message: "A released promotion claim cannot be redeemed.",
        codeId: claim.id,
      });
    }
    if (claim.state === "redeemed") return;
    if (claim.state === "released") {
      yield* Match.value(claim).pipe(
        Match.discriminatorsExhaustive("kind")({
          discount: requireReleasedCodeRedeemable,
          voucher: requireReleasedVoucherRedeemable,
        })
      );
    }

    yield* markPromotionClaimRedeemed({
      claim,
      paymentAttemptId,
      redeemedAt,
      allowReleased,
    });
  }
);

/** Locks the attempt's discount-code or voucher claim, if it has one. */
const lockAttemptPromotionClaim = Effect.fnUntraced(function* (
  paymentAttemptId: PaymentAttemptId
) {
  const { db } = yield* WorkspaceTransaction;
  const [discountClaims, voucherClaims] = yield* Effect.all([
    db
      .select({
        dotyposCustomerId: discountCodeRedemptions.dotyposCustomerId,
        id: discountCodeRedemptions.codeId,
        state: discountCodeRedemptions.state,
      })
      .from(discountCodeRedemptions)
      .where(eq(discountCodeRedemptions.paymentAttemptId, paymentAttemptId))
      .limit(1)
      .for("update"),
    db
      .select({
        applicationId: voucherRedemptions.applicationId,
        id: voucherRedemptions.voucherId,
        state: voucherRedemptions.state,
      })
      .from(voucherRedemptions)
      .where(eq(voucherRedemptions.paymentAttemptId, paymentAttemptId))
      .limit(1)
      .for("update"),
  ]);
  return selectStoredPromotionClaim(discountClaims[0], voucherClaims[0]);
});

/** A released code claim redeems again only within the code's limits. */
const requireReleasedCodeRedeemable = Effect.fnUntraced(function* (claim: {
  readonly id: DiscountCodeId;
  readonly dotyposCustomerId: DotyposCustomerId;
}) {
  const { db } = yield* WorkspaceTransaction;
  const [code] = yield* db
    .select({
      maxUses: discountCodes.maxUses,
      maxUsesPerCustomer: discountCodes.maxUsesPerCustomer,
    })
    .from(discountCodes)
    .where(eq(discountCodes.id, claim.id))
    .limit(1)
    .for("update");
  if (!code) {
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "unknown_code",
      message: "The accepted discount code no longer exists.",
      codeId: claim.id,
    });
  }

  yield* requireCustomerRedemptionsRemaining(claim, code.maxUsesPerCustomer);
  yield* requireCodeRedemptionsRemaining(claim, code.maxUses);
});

/**
 * Mirror admission: only the configured per-customer limit (null is
 * unlimited) restricts how many active uses one customer may hold.
 */
const requireCustomerRedemptionsRemaining = Effect.fnUntraced(function* (
  claim: {
    readonly id: DiscountCodeId;
    readonly dotyposCustomerId: DotyposCustomerId;
  },
  maxUsesPerCustomer: number | null
) {
  if (maxUsesPerCustomer === null) return;
  const { db } = yield* WorkspaceTransaction;
  const [customerUses] = yield* db
    .select({ count: count() })
    .from(discountCodeRedemptions)
    .where(
      and(
        eq(discountCodeRedemptions.codeId, claim.id),
        eq(discountCodeRedemptions.dotyposCustomerId, claim.dotyposCustomerId),
        inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
      )
    );
  if ((customerUses?.count ?? 0) >= maxUsesPerCustomer) {
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "usage_limit_reached",
      message: "The customer has no remaining uses for this code.",
      codeId: claim.id,
    });
  }
});

const requireCodeRedemptionsRemaining = Effect.fnUntraced(function* (
  claim: { readonly id: DiscountCodeId },
  maxUses: number | null
) {
  if (maxUses === null) return;
  const { db } = yield* WorkspaceTransaction;
  const [uses] = yield* db
    .select({ count: count() })
    .from(discountCodeRedemptions)
    .where(
      and(
        eq(discountCodeRedemptions.codeId, claim.id),
        inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
      )
    );
  if ((uses?.count ?? 0) >= maxUses) {
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "usage_limit_reached",
      message: "The accepted discount code has no remaining uses.",
      codeId: claim.id,
    });
  }
});

/** A released voucher claim redeems again only while the credit lasts. */
const requireReleasedVoucherRedeemable = Effect.fnUntraced(function* (claim: {
  readonly id: VoucherId;
  readonly applicationId: DiscountApplicationId;
}) {
  const { db } = yield* WorkspaceTransaction;
  const [voucher] = yield* db
    .select()
    .from(vouchers)
    .where(eq(vouchers.id, claim.id))
    .limit(1)
    .for("update");
  if (!voucher) {
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "unknown_code",
      message: "The accepted voucher no longer exists.",
      codeId: claim.id,
    });
  }

  const [[application], [usage]] = yield* Effect.all([
    db
      .select({
        currency: discountApplications.appliedAmountCurrency,
        exponent: discountApplications.appliedAmountExponent,
        value: discountApplications.appliedAmountValue,
      })
      .from(discountApplications)
      .where(eq(discountApplications.id, claim.applicationId))
      .limit(1),
    db
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
          eq(voucherRedemptions.voucherId, claim.id),
          inArray(voucherRedemptions.state, ["reserved", "redeemed"])
        )
      ),
  ]);
  if (
    !application ||
    !sameMoneyUnit(application, {
      currency: voucher.issuedAmountCurrency,
      exponent: voucher.issuedAmountExponent,
    }) ||
    application.value > voucher.issuedAmountValue - (usage?.value ?? 0)
  ) {
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "claim_conflict",
      message: "The voucher no longer has enough available credit.",
      codeId: claim.id,
    });
  }
});

const markPromotionClaimRedeemed = Effect.fnUntraced(function* (input: {
  readonly claim: { readonly kind: "discount" | "voucher" };
  readonly paymentAttemptId: PaymentAttemptId;
  readonly redeemedAt: Temporal.Instant;
  readonly allowReleased: boolean;
}) {
  const { db } = yield* WorkspaceTransaction;
  const values = {
    state: "redeemed" as const,
    redeemedAt: input.redeemedAt,
    releasedAt: null,
    releaseReason: null,
    updatedAt: input.redeemedAt,
  };
  const claimableStates = redeemableClaimStates(input.allowReleased);
  yield* Match.value(input.claim).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount: () =>
        db
          .update(discountCodeRedemptions)
          .set(values)
          .where(
            and(
              eq(
                discountCodeRedemptions.paymentAttemptId,
                input.paymentAttemptId
              ),
              inArray(discountCodeRedemptions.state, claimableStates)
            )
          )
          .pipe(Effect.asVoid),
      voucher: () =>
        db
          .update(voucherRedemptions)
          .set(values)
          .where(
            and(
              eq(voucherRedemptions.paymentAttemptId, input.paymentAttemptId),
              inArray(voucherRedemptions.state, claimableStates)
            )
          )
          .pipe(Effect.asVoid),
    })
  );
});

/** Late recovery may redeem a released claim again; a paid transition not. */
const redeemableClaimStates = (allowReleased: boolean) =>
  allowReleased ? (["reserved", "released"] as const) : (["reserved"] as const);

export const redeemReferralInvitationClaim = Effect.fn(
  "PaymentLifecycle.redeemReferralInvitationClaim"
)(function* (
  paymentAttemptId: PaymentAttemptId,
  workspaceReservationId: WorkspaceReservationId,
  redeemedAt: Temporal.Instant,
  allowReleased = false
) {
  const { db } = yield* WorkspaceTransaction;
  const [claim] = yield* db
    .select({
      invitedDotyposCustomerId:
        referralInvitationClaims.invitedDotyposCustomerId,
      referrerDotyposCustomerId:
        referralInvitationClaims.referrerDotyposCustomerId,
      promotionCodeId: referralInvitationClaims.promotionCodeId,
      state: referralInvitationClaims.state,
    })
    .from(referralInvitationClaims)
    .where(eq(referralInvitationClaims.paymentAttemptId, paymentAttemptId))
    .limit(1)
    .for("update");

  if (!claim || claim.state === "redeemed") return;
  if (claim.state === "released" && !allowReleased) {
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "claim_conflict",
      message: "A released referral invitation cannot be redeemed.",
    });
  }

  if (claim.state === "released") {
    yield* requireReleasedInvitationUnconsumed({
      invitedDotyposCustomerId: claim.invitedDotyposCustomerId,
      paymentAttemptId,
      workspaceReservationId,
    });
  }

  yield* db
    .update(referralInvitationClaims)
    .set({
      state: "redeemed",
      redeemedAt,
      releasedAt: null,
      releaseReason: null,
      updatedAt: redeemedAt,
    })
    .where(
      and(
        eq(referralInvitationClaims.paymentAttemptId, paymentAttemptId),
        inArray(
          referralInvitationClaims.state,
          redeemableClaimStates(allowReleased)
        )
      )
    );

  if (claim.referrerDotyposCustomerId && claim.promotionCodeId) {
    yield* recordClaimAttribution({
      invitedDotyposCustomerId: claim.invitedDotyposCustomerId,
      referrerDotyposCustomerId: claim.referrerDotyposCustomerId,
      promotionCodeId: claim.promotionCodeId,
    });
  }
});

/** A released invitation redeems again only for the invitee's first booking. */
const requireReleasedInvitationUnconsumed = Effect.fnUntraced(
  function* (input: {
    readonly invitedDotyposCustomerId: DotyposCustomerId;
    readonly paymentAttemptId: PaymentAttemptId;
    readonly workspaceReservationId: WorkspaceReservationId;
  }) {
    const { db } = yield* WorkspaceTransaction;
    const previousPayment = yield* findOtherReservationWithPayment(
      input.invitedDotyposCustomerId,
      input.workspaceReservationId,
      "paid"
    );
    const [otherActiveClaim] = yield* db
      .select({ id: referralInvitationClaims.id })
      .from(referralInvitationClaims)
      .where(
        and(
          eq(
            referralInvitationClaims.invitedDotyposCustomerId,
            input.invitedDotyposCustomerId
          ),
          ne(referralInvitationClaims.paymentAttemptId, input.paymentAttemptId),
          inArray(referralInvitationClaims.state, ["reserved", "redeemed"])
        )
      )
      .limit(1);
    if (previousPayment || otherActiveClaim) {
      return yield* new DiscountClaimError({
        operation: "redeem",
        reason: "claim_conflict",
        message:
          "The referral invitation was consumed by another paid booking.",
      });
    }
  }
);

/**
 * Records the attribution a checkout referral claim carries, in the
 * transaction that redeems it. The caller holds the referral graph lock. A
 * different referrer or a cycle that appeared since admission keeps the
 * existing graph; the paid booking itself is never undone.
 */
const recordClaimAttribution = Effect.fn(
  "PaymentLifecycle.recordClaimAttribution"
)(function* (referral: {
  readonly invitedDotyposCustomerId: DotyposCustomerId;
  readonly referrerDotyposCustomerId: DotyposCustomerId;
  readonly promotionCodeId: PromotionCodeId;
}) {
  const { db } = yield* WorkspaceTransaction;
  const graph = yield* db
    .select({
      invitedDotyposCustomerId: referralAttributions.invitedDotyposCustomerId,
      referrerDotyposCustomerId: referralAttributions.referrerDotyposCustomerId,
    })
    .from(referralAttributions);
  const decision = evaluateReferralAttribution({
    invitedCustomerId: referral.invitedDotyposCustomerId,
    referrerCustomerId: referral.referrerDotyposCustomerId,
    existingReferrerByInvitee: new Map(
      graph.map((row) => [
        row.invitedDotyposCustomerId,
        row.referrerDotyposCustomerId,
      ])
    ),
  });
  if (decision.kind === "already_accepted") return;
  if (decision.kind !== "accepted") {
    yield* Effect.logWarning(
      "Paid referral invitation kept the existing referral graph",
      { reason: decision.kind }
    );
    return;
  }
  yield* db.insert(referralAttributions).values(referral);
});

export const releaseCodeClaim = Effect.fn("PaymentLifecycle.releaseCodeClaim")(
  function* (
    paymentAttemptId: PaymentAttemptId,
    releasedAt: Temporal.Instant,
    releaseReason: string
  ) {
    const { db } = yield* WorkspaceTransaction;
    const [discountClaims, voucherClaims] = yield* Effect.all([
      db
        .select({
          id: discountCodeRedemptions.codeId,
          state: discountCodeRedemptions.state,
        })
        .from(discountCodeRedemptions)
        .where(eq(discountCodeRedemptions.paymentAttemptId, paymentAttemptId))
        .limit(1)
        .for("update"),
      db
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
    yield* Match.value(claim).pipe(
      Match.discriminatorsExhaustive("kind")({
        discount: () =>
          db
            .update(discountCodeRedemptions)
            .set(values)
            .where(
              and(
                eq(discountCodeRedemptions.paymentAttemptId, paymentAttemptId),
                eq(discountCodeRedemptions.state, "reserved")
              )
            )
            .pipe(Effect.asVoid),
        voucher: () =>
          db
            .update(voucherRedemptions)
            .set(values)
            .where(
              and(
                eq(voucherRedemptions.paymentAttemptId, paymentAttemptId),
                eq(voucherRedemptions.state, "reserved")
              )
            )
            .pipe(Effect.asVoid),
      })
    );
  }
);

const releaseReferralInvitationClaim = Effect.fn(
  "PaymentLifecycle.releaseReferralInvitationClaim"
)(function* (
  paymentAttemptId: PaymentAttemptId,
  releasedAt: Temporal.Instant,
  releaseReason: string
) {
  const { db } = yield* WorkspaceTransaction;
  const [claim] = yield* db
    .select({ state: referralInvitationClaims.state })
    .from(referralInvitationClaims)
    .where(eq(referralInvitationClaims.paymentAttemptId, paymentAttemptId))
    .limit(1)
    .for("update");
  if (!claim) return;
  if (claim.state === "redeemed") {
    return yield* new DiscountClaimError({
      operation: "release",
      reason: "claim_conflict",
      message: "A redeemed referral invitation cannot be released.",
    });
  }
  if (claim.state === "released") return;

  yield* db
    .update(referralInvitationClaims)
    .set({
      state: "released",
      releasedAt,
      releaseReason,
      updatedAt: releasedAt,
    })
    .where(
      and(
        eq(referralInvitationClaims.paymentAttemptId, paymentAttemptId),
        eq(referralInvitationClaims.state, "reserved")
      )
    )
    .pipe(Effect.asVoid);
});

const selectStoredPromotionClaim = <
  DiscountClaim extends { readonly id: DiscountCodeId; readonly state: string },
  VoucherClaim extends { readonly id: VoucherId; readonly state: string },
>(
  discountClaim: DiscountClaim | undefined,
  voucherClaim: VoucherClaim | undefined
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
  "referral_invitation_claims_active_customer_unique_idx",
  "referral_invitation_claims_application_unique_idx",
  "referral_invitation_claims_attempt_unique_idx",
]);

/**
 * Reports a claim that lost the race for an active discount or voucher claim
 * as a claim conflict. The transaction has already rolled back.
 */
const failActiveClaimConflict = <E extends DatabaseQueryError>(cause: E) =>
  Effect.fail(
    findViolatedConstraint(cause).pipe(
      Option.exists((constraint) => activeClaimConstraints.has(constraint))
    )
      ? new DiscountClaimError({
          operation: "reserve",
          reason: "claim_conflict",
          message: "The discount code was claimed by another payment attempt.",
          cause,
        })
      : cause
  );
