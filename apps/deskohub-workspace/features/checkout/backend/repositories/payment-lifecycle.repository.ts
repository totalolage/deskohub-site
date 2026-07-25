import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Predicate } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import {
  discountApplications,
  discountCodeCustomers,
  discountCodeRedemptions,
  discountCodes,
  discountProductTargets,
  discounts,
  paymentAttempts,
  paymentPaidEvents,
  workspaceReservations,
} from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";
import { getWorkspaceProductKey } from "@/features/checkout/product-identity";
import {
  type WorkspaceMoney,
  workspaceMoneyEquals,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import {
  type DiscountCommitment,
  materializeDiscountCommitment,
} from "@/features/discounts/commitment";
import type {
  AppliedDiscount,
  DiscountAdjustment,
} from "@/features/discounts/contracts";
import { getDiscountCodeTiming } from "@/features/discounts/discount-code";
import { decodeDiscountDefinition } from "@/features/discounts/discount-definition";
import { DiscountClaimError } from "@/features/discounts/errors";
import type { DiscountApplicationId } from "@/features/discounts/persistence-contracts";
import type { DiscountClaimInstruction } from "@/features/discounts/provider";
import type { Locale } from "@/features/i18n";
import {
  type PaymentAttempt,
  toPaymentAttempt,
} from "./payment-attempt.repository";

export class PaymentLifecycleStateError extends Data.TaggedError(
  "PaymentLifecycleStateError"
)<{
  readonly operation: string;
  readonly paymentAttemptId: string;
  readonly message: string;
}> {}

export interface PaymentLifecycleTransition {
  readonly attempt: PaymentAttempt;
  readonly changed: boolean;
  readonly timestamp: Temporal.Instant;
}

export interface PaymentPricingIdentity {
  readonly fingerprint: string;
  readonly total: WorkspaceMoney;
  readonly discounts: readonly AppliedDiscount[];
}

export type PaymentStartAdmission =
  | { readonly outcome: "reuse"; readonly attempt: PaymentAttempt }
  | { readonly outcome: "starting"; readonly attempt: PaymentAttempt }
  | {
      readonly outcome: "created";
      readonly attempt: PaymentAttempt;
      readonly providerStartLeaseId: string;
    }
  | {
      readonly outcome: "unavailable";
      readonly reason: "reservation" | "active_attempt" | "payment_state";
    }
  | {
      readonly outcome: "pricing_changed";
      readonly reason: string;
    };

export type ProviderSessionAttach =
  | { readonly outcome: "attached"; readonly attempt: PaymentAttempt }
  | { readonly outcome: "lost" };

export type PaymentLifecycleRepositoryError =
  | DiscountClaimError
  | EffectDrizzleQueryError
  | PaymentLifecycleStateError
  | SqlError;

export interface IPaymentLifecycleRepository {
  readonly admitPaymentStart: (input: {
    readonly workspaceReservationId: string;
    readonly checkoutSessionKey: string;
    readonly providerOrderId: string;
    readonly acceptedPricing: PaymentPricingIdentity;
    readonly affirmedPricing: PaymentPricingIdentity;
    readonly commitment: DiscountCommitment;
    readonly locale: Locale;
  }) => Effect.Effect<PaymentStartAdmission, PaymentLifecycleRepositoryError>;
  readonly attachProviderSession: (input: {
    readonly id: string;
    readonly workspaceReservationId: string;
    readonly checkoutSessionKey: string;
    readonly providerOrderId: string;
    readonly providerStartLeaseId: string;
    readonly securityToken: string;
    readonly providerRedirectUrl: string;
  }) => Effect.Effect<ProviderSessionAttach, EffectDrizzleQueryError>;
  readonly markPaid: (input: {
    readonly id: string;
    readonly workspaceReservationId: string;
    readonly webhookEventId?: string;
    readonly providerOperationId?: string;
    readonly providerStatus?: string;
    readonly paidAt: Temporal.Instant;
  }) => Effect.Effect<
    PaymentLifecycleTransition,
    PaymentLifecycleRepositoryError
  >;
  readonly markTerminal: (input: {
    readonly id: string;
    readonly workspaceReservationId: string;
    readonly state: "failed" | "cancelled" | "expired";
    readonly failureCode: string;
    readonly webhookEventId?: string;
    readonly providerOperationId?: string;
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

      const admitPaymentStart = Effect.fn(
        "PaymentLifecycleRepository.admitPaymentStart"
      )(function* (input: {
        readonly workspaceReservationId: string;
        readonly checkoutSessionKey: string;
        readonly providerOrderId: string;
        readonly acceptedPricing: PaymentPricingIdentity;
        readonly affirmedPricing: PaymentPricingIdentity;
        readonly commitment: DiscountCommitment;
        readonly locale: Locale;
      }) {
        const transaction = db.transaction((tx) =>
          Effect.gen(function* () {
            if (!pricingIdentitiesEqual(input)) {
              return {
                outcome: "pricing_changed" as const,
                reason: "displayed_pricing_mismatch",
              };
            }

            const commitment = materializeDiscountCommitment(
              input.commitment,
              input.acceptedPricing.discounts
            );
            if (commitment.status === "pricing_changed") {
              return {
                outcome: "pricing_changed" as const,
                reason: "discount_commitment_mismatch",
              };
            }
            const claimedApplication =
              yield* validateDiscountCommitment(commitment);

            const [reservation] = yield* tx
              .select({
                id: workspaceReservations.id,
                dotyposCustomerId: workspaceReservations.dotyposCustomerId,
                paymentState: workspaceReservations.paymentState,
                activePaymentAttemptId:
                  workspaceReservations.activePaymentAttemptId,
                reservationHoldExpiresAt:
                  workspaceReservations.reservationHoldExpiresAt,
              })
              .from(workspaceReservations)
              .where(
                and(
                  eq(workspaceReservations.id, input.workspaceReservationId),
                  eq(
                    workspaceReservations.checkoutSessionKey,
                    input.checkoutSessionKey
                  ),
                  eq(workspaceReservations.reservationState, "held"),
                  hasNoUnresolvedProviderAttachmentRecovery(),
                  sql`${workspaceReservations.reservationHoldExpiresAt} > clock_timestamp()`
                )
              )
              .limit(1)
              .for("update");

            if (!reservation?.reservationHoldExpiresAt) {
              return {
                outcome: "unavailable" as const,
                reason: "reservation" as const,
              };
            }

            const [databaseClock] = yield* tx
              .select({
                now: sql<Temporal.Instant>`clock_timestamp()`,
              })
              .from(workspaceReservations)
              .where(eq(workspaceReservations.id, reservation.id))
              .limit(1);
            if (!databaseClock) {
              return yield* Effect.die("Database clock returned no row.");
            }
            const databaseNow = normalizeDatabaseInstant(databaseClock.now);

            if (reservation.activePaymentAttemptId) {
              const existing = yield* loadAttemptAdmission({
                tx,
                paymentAttemptId: reservation.activePaymentAttemptId,
                pricing: input.acceptedPricing,
              });

              if (
                !existing ||
                existing.attempt.workspaceReservationId !== reservation.id
              ) {
                return {
                  outcome: "unavailable" as const,
                  reason: "active_attempt" as const,
                };
              }
              if (
                existing.attempt.state === "created" ||
                existing.attempt.state === "pending"
              ) {
                if (reservation.paymentState !== "pending") {
                  return {
                    outcome: "unavailable" as const,
                    reason: "payment_state" as const,
                  };
                }
                if (!existing.pricingMatches) {
                  return {
                    outcome: "pricing_changed" as const,
                    reason: "active_attempt_pricing_mismatch",
                  };
                }
              }

              if (existing.attempt.state === "pending") {
                if (
                  existing.attempt.securityToken &&
                  existing.attempt.providerRedirectUrl
                ) {
                  return {
                    outcome: "reuse" as const,
                    attempt: toPaymentAttempt(existing.attempt),
                  };
                }
                return {
                  outcome: "unavailable" as const,
                  reason: "active_attempt" as const,
                };
              }

              if (existing.attempt.state === "created") {
                if (
                  existing.attempt.providerStartLeaseExpiresAt &&
                  Temporal.Instant.compare(
                    existing.attempt.providerStartLeaseExpiresAt,
                    databaseNow
                  ) > 0
                ) {
                  return {
                    outcome: "starting" as const,
                    attempt: toPaymentAttempt(existing.attempt),
                  };
                }

                const providerStartLeaseId = randomUUID();
                const [renewed] = yield* tx
                  .update(paymentAttempts)
                  .set({
                    providerStartLeaseId,
                    providerStartLeaseExpiresAt: sql`clock_timestamp() + interval '30 seconds'`,
                    updatedAt: sql`clock_timestamp()`,
                  })
                  .where(
                    and(
                      eq(paymentAttempts.id, existing.attempt.id),
                      eq(paymentAttempts.state, "created"),
                      sql`coalesce(${paymentAttempts.providerStartLeaseExpiresAt}, '-infinity'::timestamptz) <= clock_timestamp()`
                    )
                  )
                  .returning();

                if (!renewed) {
                  return {
                    outcome: "starting" as const,
                    attempt: toPaymentAttempt(existing.attempt),
                  };
                }

                return {
                  outcome: "created" as const,
                  attempt: toPaymentAttempt(renewed),
                  providerStartLeaseId,
                };
              }

              if (existing.attempt.state === "paid") {
                return {
                  outcome: "unavailable" as const,
                  reason: "payment_state" as const,
                };
              }
              if (reservation.paymentState !== existing.attempt.state) {
                return {
                  outcome: "unavailable" as const,
                  reason: "payment_state" as const,
                };
              }
            } else if (reservation.paymentState === "pending") {
              return {
                outcome: "unavailable" as const,
                reason: "active_attempt" as const,
              };
            }

            if (
              reservation.paymentState !== "not_started" &&
              reservation.paymentState !== "failed" &&
              reservation.paymentState !== "cancelled" &&
              reservation.paymentState !== "expired"
            ) {
              return {
                outcome: "unavailable" as const,
                reason: "payment_state" as const,
              };
            }

            const providerStartLeaseId = randomUUID();
            const [attemptRow] = yield* tx
              .insert(paymentAttempts)
              .values({
                id: postgresUuidV7,
                workspaceReservationId: input.workspaceReservationId,
                provider: "nexi",
                providerOrderId: input.providerOrderId,
                admissionVersion: 2,
                pricingFingerprint: input.acceptedPricing.fingerprint,
                displayedDiscountIds: commitment.displayedDiscountIds,
                providerStartLeaseId,
                providerStartLeaseExpiresAt: sql`clock_timestamp() + interval '30 seconds'`,
                state: "created",
                amountValue: input.acceptedPricing.total.value,
                amountExponent: input.acceptedPricing.total.exponent,
                currency: input.acceptedPricing.total.currency,
              })
              .returning();

            if (!attemptRow) {
              return yield* Effect.die(
                "Payment attempt insert returned no row."
              );
            }

            const [linked] = yield* tx
              .update(workspaceReservations)
              .set({
                activePaymentAttemptId: attemptRow.id,
                paymentState: "pending",
                updatedAt: sql`clock_timestamp()`,
              })
              .where(
                and(
                  eq(workspaceReservations.id, input.workspaceReservationId),
                  eq(
                    workspaceReservations.checkoutSessionKey,
                    input.checkoutSessionKey
                  ),
                  eq(workspaceReservations.reservationState, "held"),
                  inArray(workspaceReservations.paymentState, [
                    "not_started",
                    "failed",
                    "cancelled",
                    "expired",
                  ]),
                  hasNoUnresolvedProviderAttachmentRecovery(),
                  sql`${workspaceReservations.reservationHoldExpiresAt} > clock_timestamp()`
                )
              )
              .returning({ id: workspaceReservations.id });

            if (!linked) {
              return yield* lifecycleStateError(
                "admitPaymentStart",
                attemptRow.id,
                "The payable reservation changed during payment admission."
              );
            }

            const applicationRows =
              commitment.applications.length === 0
                ? []
                : yield* tx
                    .insert(discountApplications)
                    .values(
                      commitment.applications.map(
                        ({ application, provenance }, sequence) => ({
                          paymentAttemptId: attemptRow.id,
                          workspaceReservationId: input.workspaceReservationId,
                          sequence,
                          publicDiscountId: application.discount.id,
                          label: application.discount.label,
                          adjustment: application.discount.adjustment,
                          productIdentity: commitment.product,
                          subtotalBeforeValue: application.subtotalBefore.value,
                          subtotalBeforeExponent:
                            application.subtotalBefore.exponent,
                          subtotalBeforeCurrency:
                            application.subtotalBefore.currency,
                          appliedAmountValue: application.amount.value,
                          appliedAmountExponent: application.amount.exponent,
                          appliedAmountCurrency: application.amount.currency,
                          subtotalAfterValue: application.subtotalAfter.value,
                          subtotalAfterExponent:
                            application.subtotalAfter.exponent,
                          subtotalAfterCurrency:
                            application.subtotalAfter.currency,
                          expiresAt: application.discount.expiresAt
                            ? Temporal.Instant.from(
                                application.discount.expiresAt
                              )
                            : null,
                          countdownStartsAt: application.discount
                            .countdownStartsAt
                            ? Temporal.Instant.from(
                                application.discount.countdownStartsAt
                              )
                            : null,
                          provenance,
                        })
                      )
                    )
                    .returning({
                      id: discountApplications.id,
                      sequence: discountApplications.sequence,
                    });

            if (claimedApplication) {
              const applicationId = applicationRows.find(
                ({ sequence }) => sequence === claimedApplication.index
              )?.id;
              if (!applicationId) {
                return yield* claimError(
                  "reserve",
                  "claim_conflict",
                  "The claimed discount application was not persisted.",
                  claimedApplication.claim
                );
              }

              yield* reserveCodeClaim({
                tx,
                claim: claimedApplication.claim,
                application: claimedApplication.application,
                applicationId,
                paymentAttemptId: attemptRow.id,
                locale: input.locale,
                reservationCustomerId: reservation.dotyposCustomerId,
                reservationExpiresAt: reservation.reservationHoldExpiresAt,
                databaseNow,
              });
            }

            return {
              outcome: "created" as const,
              attempt: toPaymentAttempt(attemptRow),
              providerStartLeaseId,
            };
          })
        );

        return yield* transaction.pipe(
          Effect.catch((cause) => {
            if (Predicate.isTagged(cause, "DiscountClaimError")) {
              return Effect.succeed({
                outcome: "pricing_changed" as const,
                reason: cause.reason,
              });
            }
            if (isActiveClaimUniqueViolation(cause)) {
              return Effect.succeed({
                outcome: "pricing_changed" as const,
                reason: getUniqueConstraint(cause) ?? "discount_claim_conflict",
              });
            }
            return Effect.fail(cause);
          })
        );
      });

      const attachProviderSession = Effect.fn(
        "PaymentLifecycleRepository.attachProviderSession"
      )(function* (input: {
        readonly id: string;
        readonly workspaceReservationId: string;
        readonly checkoutSessionKey: string;
        readonly providerOrderId: string;
        readonly providerStartLeaseId: string;
        readonly securityToken: string;
        readonly providerRedirectUrl: string;
      }) {
        const [attempt] = yield* db
          .update(paymentAttempts)
          .set({
            state: "pending",
            securityToken: input.securityToken,
            providerRedirectUrl: input.providerRedirectUrl,
            providerStartLeaseId: null,
            providerStartLeaseExpiresAt: null,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(paymentAttempts.id, input.id),
              eq(
                paymentAttempts.workspaceReservationId,
                input.workspaceReservationId
              ),
              eq(paymentAttempts.providerOrderId, input.providerOrderId),
              eq(
                paymentAttempts.providerStartLeaseId,
                input.providerStartLeaseId
              ),
              eq(paymentAttempts.state, "created"),
              sql`${paymentAttempts.providerStartLeaseExpiresAt} > clock_timestamp()`,
              sql`exists (
                select 1
                from workspace_reservations as payable
                where payable.id = ${input.workspaceReservationId}
                  and payable.checkout_session_key = ${input.checkoutSessionKey}
                  and payable.reservation_state = 'held'
                  and payable.payment_state = 'pending'
                  and payable.active_payment_attempt_id = ${input.id}
                  and (
                    payable.failure_code is null
                    or (
                      payable.failure_code not like 'hold_creation_candidate:%'
                      and payable.failure_code not like 'hold_creation_candidate_compensating:%'
                      and payable.failure_code not like 'hold_creation_orphan_recovery:%'
                      and payable.failure_code not like 'hold_creation_orphan_processing:%'
                      and payable.failure_code not like 'hold_creation_orphan_awaiting_visibility:%'
                      and payable.failure_code not like 'hold_creation_orphan_verifying:%'
                    )
                  )
                  and payable.reservation_hold_expires_at > clock_timestamp()
              )`
            )
          )
          .returning();

        if (!attempt) {
          return { outcome: "lost" as const };
        }

        return {
          outcome: "attached" as const,
          attempt: toPaymentAttempt(attempt),
        };
      });

      const markPaid = Effect.fn("PaymentLifecycleRepository.markPaid")(
        function* (input: {
          readonly id: string;
          readonly workspaceReservationId: string;
          readonly webhookEventId?: string;
          readonly providerOperationId?: string;
          readonly providerStatus?: string;
          readonly paidAt: Temporal.Instant;
        }) {
          return yield* db.transaction((tx) =>
            Effect.gen(function* () {
              const [currentAttempt] = yield* tx
                .select()
                .from(paymentAttempts)
                .where(
                  and(
                    eq(paymentAttempts.id, input.id),
                    eq(
                      paymentAttempts.workspaceReservationId,
                      input.workspaceReservationId
                    )
                  )
                )
                .limit(1)
                .for("update");

              if (!currentAttempt) {
                return yield* lifecycleStateError(
                  "markPaid",
                  input.id,
                  "The payment attempt does not belong to the reservation."
                );
              }

              if (currentAttempt.state === "paid") {
                const [consistent] = yield* tx
                  .select({ paidAt: workspaceReservations.paidAt })
                  .from(workspaceReservations)
                  .where(
                    and(
                      eq(
                        workspaceReservations.id,
                        input.workspaceReservationId
                      ),
                      eq(workspaceReservations.paymentState, "paid"),
                      eq(workspaceReservations.activePaymentAttemptId, input.id)
                    )
                  )
                  .limit(1);
                if (!consistent) {
                  return yield* lifecycleStateError(
                    "markPaid",
                    input.id,
                    "The already-paid attempt is not the reservation's paid attempt."
                  );
                }

                const paidAt = consistent.paidAt ?? input.paidAt;
                yield* redeemCodeClaim(tx, input.id, paidAt);
                yield* enqueuePaidEvent(
                  tx,
                  input.id,
                  input.workspaceReservationId,
                  paidAt
                );
                return {
                  attempt: toPaymentAttempt(currentAttempt),
                  changed: false,
                  timestamp: paidAt,
                };
              }

              if (
                currentAttempt.state !== "created" &&
                currentAttempt.state !== "pending"
              ) {
                return yield* lifecycleStateError(
                  "markPaid",
                  input.id,
                  "A terminal unsuccessful attempt cannot be marked paid."
                );
              }

              const [attempt] = yield* tx
                .update(paymentAttempts)
                .set({
                  state: "paid",
                  lastWebhookEventId: input.webhookEventId,
                  lastProviderOperationId: input.providerOperationId,
                  lastProviderStatus: input.providerStatus,
                  failureCode: null,
                  providerStartLeaseId: null,
                  providerStartLeaseExpiresAt: null,
                  updatedAt: input.paidAt,
                })
                .where(
                  and(
                    eq(paymentAttempts.id, input.id),
                    eq(
                      paymentAttempts.workspaceReservationId,
                      input.workspaceReservationId
                    ),
                    inArray(paymentAttempts.state, ["created", "pending"])
                  )
                )
                .returning();

              if (!attempt) {
                return yield* lifecycleStateError(
                  "markPaid",
                  input.id,
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
                yield* enqueuePaidEvent(
                  tx,
                  input.id,
                  input.workspaceReservationId,
                  reservation.paidAt ?? input.paidAt
                );
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
                  input.id,
                  "Only the active pending attempt on a held reservation can mark payment paid."
                );
              }

              yield* redeemCodeClaim(tx, input.id, input.paidAt);
              yield* enqueuePaidEvent(
                tx,
                input.id,
                input.workspaceReservationId,
                consistent.paidAt ?? input.paidAt
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
          readonly id: string;
          readonly workspaceReservationId: string;
          readonly state: "failed" | "cancelled" | "expired";
          readonly failureCode: string;
          readonly webhookEventId?: string;
          readonly providerOperationId?: string;
          readonly providerStatus?: string;
        }) {
          const terminalAt = Temporal.Now.instant();

          return yield* db.transaction((tx) =>
            Effect.gen(function* () {
              const [currentAttempt] = yield* tx
                .select()
                .from(paymentAttempts)
                .where(
                  and(
                    eq(paymentAttempts.id, input.id),
                    eq(
                      paymentAttempts.workspaceReservationId,
                      input.workspaceReservationId
                    )
                  )
                )
                .limit(1)
                .for("update");
              if (!currentAttempt) {
                return yield* lifecycleStateError(
                  "markTerminal",
                  input.id,
                  "The payment attempt does not belong to the reservation."
                );
              }

              if (currentAttempt.state === "paid") {
                return yield* lifecycleStateError(
                  "markTerminal",
                  input.id,
                  "A paid attempt cannot be overwritten by stale terminal settlement."
                );
              }

              if (
                currentAttempt.state === "failed" ||
                currentAttempt.state === "cancelled" ||
                currentAttempt.state === "expired"
              ) {
                const [consistent] = yield* tx
                  .select({ updatedAt: workspaceReservations.updatedAt })
                  .from(workspaceReservations)
                  .where(
                    and(
                      eq(
                        workspaceReservations.id,
                        input.workspaceReservationId
                      ),
                      eq(
                        workspaceReservations.paymentState,
                        currentAttempt.state
                      ),
                      eq(workspaceReservations.activePaymentAttemptId, input.id)
                    )
                  )
                  .limit(1);
                if (!consistent) {
                  return yield* lifecycleStateError(
                    "markTerminal",
                    input.id,
                    "The terminal attempt does not match the reservation aggregate."
                  );
                }
                yield* releaseCodeClaim(
                  tx,
                  input.id,
                  consistent.updatedAt,
                  currentAttempt.failureCode ?? input.failureCode
                );
                return {
                  attempt: toPaymentAttempt(currentAttempt),
                  changed: false,
                  timestamp: consistent.updatedAt,
                };
              }

              const [attempt] = yield* tx
                .update(paymentAttempts)
                .set({
                  state: input.state,
                  failureCode: input.failureCode,
                  lastWebhookEventId: input.webhookEventId,
                  lastProviderOperationId: input.providerOperationId,
                  lastProviderStatus: input.providerStatus,
                  providerStartLeaseId: null,
                  providerStartLeaseExpiresAt: null,
                  updatedAt: terminalAt,
                })
                .where(
                  and(
                    eq(paymentAttempts.id, input.id),
                    eq(
                      paymentAttempts.workspaceReservationId,
                      input.workspaceReservationId
                    ),
                    inArray(paymentAttempts.state, ["created", "pending"])
                  )
                )
                .returning();

              if (!attempt) {
                return yield* lifecycleStateError(
                  "markTerminal",
                  input.id,
                  "Only a non-terminal or matching terminal attempt can mark a reservation terminal."
                );
              }

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
                  input.id,
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
        admitPaymentStart,
        attachProviderSession,
        markPaid,
        markTerminal,
      } satisfies IPaymentLifecycleRepository;
    })
  );
}

type CommitmentPayload = Extract<
  ReturnType<typeof materializeDiscountCommitment>,
  { readonly status: "ready" }
>;

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
        codeId: claim?.codeId,
      });
    }

    if (
      claim &&
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

const pricingIdentitiesEqual = (input: {
  readonly acceptedPricing: PaymentPricingIdentity;
  readonly affirmedPricing: PaymentPricingIdentity;
}) =>
  input.acceptedPricing.fingerprint === input.affirmedPricing.fingerprint &&
  workspaceMoneyEquals(
    input.acceptedPricing.total,
    input.affirmedPricing.total
  ) &&
  input.acceptedPricing.discounts.length ===
    input.affirmedPricing.discounts.length &&
  input.acceptedPricing.discounts.every((application, index) =>
    discountApplicationsEqual(
      application,
      input.affirmedPricing.discounts[index]
    )
  );

const discountApplicationsEqual = (
  left: AppliedDiscount,
  right: AppliedDiscount | undefined
) =>
  right !== undefined &&
  left.discount.id === right.discount.id &&
  left.discount.label === right.discount.label &&
  left.discount.expiresAt === right.discount.expiresAt &&
  left.discount.countdownStartsAt === right.discount.countdownStartsAt &&
  discountAdjustmentsEqual(
    left.discount.adjustment,
    right.discount.adjustment
  ) &&
  workspaceMoneyEquals(left.subtotalBefore, right.subtotalBefore) &&
  workspaceMoneyEquals(left.amount, right.amount) &&
  workspaceMoneyEquals(left.subtotalAfter, right.subtotalAfter);

const loadAttemptAdmission = Effect.fn("PaymentLifecycle.loadAttemptAdmission")(
  function* (input: {
    readonly tx: TransactionClient;
    readonly paymentAttemptId: string;
    readonly pricing: PaymentPricingIdentity;
  }) {
    const [attempt] = yield* input.tx
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, input.paymentAttemptId))
      .limit(1)
      .for("update");
    if (!attempt) return null;

    const applications = yield* input.tx
      .select({
        id: discountApplications.publicDiscountId,
        label: discountApplications.label,
      })
      .from(discountApplications)
      .where(eq(discountApplications.paymentAttemptId, attempt.id))
      .orderBy(asc(discountApplications.sequence));
    const expectedDiscounts = input.pricing.discounts.map(({ discount }) => ({
      id: discount.id,
      label: discount.label,
    }));

    return {
      attempt,
      pricingMatches:
        attempt.admissionVersion === 2 &&
        attempt.pricingFingerprint === input.pricing.fingerprint &&
        workspaceMoneyEquals(
          {
            value: attempt.amountValue,
            exponent: attempt.amountExponent,
            currency: attempt.currency,
          },
          input.pricing.total
        ) &&
        stringArraysEqual(
          attempt.displayedDiscountIds ?? [],
          expectedDiscounts.map(({ id }) => id)
        ) &&
        applications.length === expectedDiscounts.length &&
        applications.every(
          (application, index) =>
            application.id === expectedDiscounts[index]?.id &&
            application.label === expectedDiscounts[index]?.label
        ),
    };
  }
);

const stringArraysEqual = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const normalizeDatabaseInstant = (
  value: Temporal.Instant | Date | string
): Temporal.Instant =>
  value instanceof Date
    ? Temporal.Instant.from(value.toISOString())
    : Temporal.Instant.from(value);

const hasNoUnresolvedProviderAttachmentRecovery = () =>
  sql`(
    ${workspaceReservations.failureCode} is null
    or (
      ${workspaceReservations.failureCode} not like 'hold_creation_candidate:%'
      and ${workspaceReservations.failureCode} not like 'hold_creation_candidate_compensating:%'
      and ${workspaceReservations.failureCode} not like 'hold_creation_orphan_recovery:%'
      and ${workspaceReservations.failureCode} not like 'hold_creation_orphan_processing:%'
      and ${workspaceReservations.failureCode} not like 'hold_creation_orphan_awaiting_visibility:%'
      and ${workspaceReservations.failureCode} not like 'hold_creation_orphan_verifying:%'
    )
  )`;

const lifecycleStateError = (
  operation: string,
  paymentAttemptId: string,
  message: string
) =>
  new PaymentLifecycleStateError({
    operation: `PaymentLifecycleRepository.${operation}`,
    paymentAttemptId,
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
    codeId: claim?.codeId,
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

const reserveCodeClaim = Effect.fn("PaymentLifecycle.reserveCodeClaim")(
  function* (input: {
    readonly tx: TransactionClient;
    readonly claim: DiscountClaimInstruction;
    readonly application: AppliedDiscount;
    readonly applicationId: DiscountApplicationId;
    readonly paymentAttemptId: string;
    readonly locale: Locale;
    readonly reservationCustomerId: string;
    readonly reservationExpiresAt: Temporal.Instant;
    readonly databaseNow: Temporal.Instant;
  }) {
    if (input.reservationCustomerId !== input.claim.dotyposCustomerId) {
      return yield* claimError(
        "reserve",
        "customer_ineligible",
        "The discount-code claim customer does not match the reservation.",
        input.claim
      );
    }

    const [code] = yield* input.tx
      .select()
      .from(discountCodes)
      .where(eq(discountCodes.id, input.claim.codeId))
      .limit(1)
      .for("update");

    if (!code || code.discountId !== input.claim.storedDiscountId) {
      return yield* claimError(
        "reserve",
        "unknown_code",
        "The accepted discount code no longer exists.",
        input.claim
      );
    }

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
    if (!code.enabled) {
      return yield* claimError(
        "reserve",
        "inactive",
        "The accepted discount code is inactive.",
        input.claim
      );
    }

    const [target] = yield* input.tx
      .select({ discountId: discountProductTargets.discountId })
      .from(discountProductTargets)
      .where(
        and(
          eq(discountProductTargets.discountId, input.claim.storedDiscountId),
          eq(discountProductTargets.productIdentity, input.claim.product)
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

    const claimedAt = input.databaseNow;
    if (Temporal.Instant.compare(input.reservationExpiresAt, claimedAt) <= 0) {
      return yield* lifecycleStateError(
        "admitPaymentStart",
        input.paymentAttemptId,
        "Discount claims can only be reserved for a current held reservation."
      );
    }
    if (
      code.validFrom &&
      Temporal.Instant.compare(claimedAt, code.validFrom) < 0
    ) {
      return yield* claimError(
        "reserve",
        "not_started",
        "The accepted discount code is not valid yet.",
        input.claim
      );
    }
    if (
      code.validUntil &&
      Temporal.Instant.compare(claimedAt, code.validUntil) >= 0
    ) {
      return yield* claimError(
        "reserve",
        "expired",
        "The accepted discount code has expired.",
        input.claim
      );
    }

    const currentDefinition = yield* decodeDiscountDefinition({
      row: {
        ...definition,
        productTargets: [
          {
            discountId: target.discountId,
            productIdentity: input.claim.product,
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
    const currentTiming = getDiscountCodeTiming(code.validUntil);
    if (
      !discountAdjustmentsEqual(
        currentDefinition.adjustment,
        input.application.discount.adjustment
      ) ||
      currentDefinition.labels[input.locale] !==
        input.application.discount.label ||
      currentTiming.expiresAt !== input.application.discount.expiresAt ||
      currentTiming.countdownStartsAt !==
        input.application.discount.countdownStartsAt
    ) {
      return yield* claimError(
        "reserve",
        "claim_conflict",
        "The accepted discount benefit changed before claim admission.",
        input.claim
      );
    }

    const [allowlist] = yield* input.tx
      .select({ count: count() })
      .from(discountCodeCustomers)
      .where(eq(discountCodeCustomers.codeId, input.claim.codeId));
    if ((allowlist?.count ?? 0) > 0) {
      const [customer] = yield* input.tx
        .select({ codeId: discountCodeCustomers.codeId })
        .from(discountCodeCustomers)
        .where(
          and(
            eq(discountCodeCustomers.codeId, input.claim.codeId),
            eq(
              discountCodeCustomers.dotyposCustomerId,
              input.claim.dotyposCustomerId
            )
          )
        )
        .limit(1);
      if (!customer) {
        return yield* claimError(
          "reserve",
          "customer_ineligible",
          "The customer is no longer eligible for the accepted discount code.",
          input.claim
        );
      }
    }

    const [customerUse] = yield* input.tx
      .select({ state: discountCodeRedemptions.state })
      .from(discountCodeRedemptions)
      .where(
        and(
          eq(discountCodeRedemptions.codeId, input.claim.codeId),
          eq(
            discountCodeRedemptions.dotyposCustomerId,
            input.claim.dotyposCustomerId
          ),
          inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
        )
      )
      .limit(1);

    if (customerUse?.state === "redeemed") {
      return yield* claimError(
        "reserve",
        "already_redeemed",
        "The customer has already redeemed this discount code.",
        input.claim
      );
    }
    if (customerUse) {
      return yield* claimError(
        "reserve",
        "claim_conflict",
        "The customer already has an active claim for this discount code.",
        input.claim
      );
    }

    if (code.maxUses !== null) {
      const [uses] = yield* input.tx
        .select({ count: count() })
        .from(discountCodeRedemptions)
        .where(
          and(
            eq(discountCodeRedemptions.codeId, input.claim.codeId),
            inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
          )
        );

      if ((uses?.count ?? 0) >= code.maxUses) {
        return yield* claimError(
          "reserve",
          "usage_limit_reached",
          "The accepted discount code has no remaining uses.",
          input.claim
        );
      }
    }

    yield* input.tx.insert(discountCodeRedemptions).values({
      codeId: input.claim.codeId,
      applicationId: input.applicationId,
      paymentAttemptId: input.paymentAttemptId,
      dotyposCustomerId: input.claim.dotyposCustomerId,
      state: "reserved",
      reservationExpiresAt: input.reservationExpiresAt,
      reservedAt: claimedAt,
      updatedAt: claimedAt,
    });
  }
);

const redeemCodeClaim = Effect.fn("PaymentLifecycle.redeemCodeClaim")(
  function* (
    tx: TransactionClient,
    paymentAttemptId: string,
    redeemedAt: Temporal.Instant
  ) {
    const [claim] = yield* tx
      .select({
        codeId: discountCodeRedemptions.codeId,
        state: discountCodeRedemptions.state,
      })
      .from(discountCodeRedemptions)
      .where(eq(discountCodeRedemptions.paymentAttemptId, paymentAttemptId))
      .limit(1)
      .for("update");

    if (!claim) return;
    if (claim.state === "released") {
      return yield* new DiscountClaimError({
        operation: "redeem",
        reason: "claim_conflict",
        message: "A released discount-code claim cannot be redeemed.",
        codeId: claim.codeId,
      });
    }
    if (claim.state === "redeemed") return;

    yield* tx
      .update(discountCodeRedemptions)
      .set({
        state: "redeemed",
        redeemedAt,
        updatedAt: redeemedAt,
      })
      .where(
        and(
          eq(discountCodeRedemptions.paymentAttemptId, paymentAttemptId),
          eq(discountCodeRedemptions.state, "reserved")
        )
      );
  }
);

const enqueuePaidEvent = Effect.fn("PaymentLifecycle.enqueuePaidEvent")(
  (
    tx: TransactionClient,
    paymentAttemptId: string,
    workspaceReservationId: string,
    paidAt: Temporal.Instant
  ) =>
    tx
      .insert(paymentPaidEvents)
      .values({
        paymentAttemptId,
        workspaceReservationId,
        paidAt,
      })
      .onConflictDoNothing({
        target: paymentPaidEvents.paymentAttemptId,
      })
      .pipe(Effect.asVoid)
);

const releaseCodeClaim = Effect.fn("PaymentLifecycle.releaseCodeClaim")(
  function* (
    tx: TransactionClient,
    paymentAttemptId: string,
    releasedAt: Temporal.Instant,
    releaseReason: string
  ) {
    const [claim] = yield* tx
      .select({
        codeId: discountCodeRedemptions.codeId,
        state: discountCodeRedemptions.state,
      })
      .from(discountCodeRedemptions)
      .where(eq(discountCodeRedemptions.paymentAttemptId, paymentAttemptId))
      .limit(1)
      .for("update");

    if (!claim) return;
    if (claim.state === "redeemed") {
      return yield* new DiscountClaimError({
        operation: "release",
        reason: "claim_conflict",
        message: "A redeemed discount-code claim cannot be released.",
        codeId: claim.codeId,
      });
    }
    if (claim.state === "released") return;

    yield* tx
      .update(discountCodeRedemptions)
      .set({
        state: "released",
        releasedAt,
        releaseReason,
        updatedAt: releasedAt,
      })
      .where(
        and(
          eq(discountCodeRedemptions.paymentAttemptId, paymentAttemptId),
          eq(discountCodeRedemptions.state, "reserved")
        )
      );
  }
);

const activeClaimConstraints = new Set([
  "discount_code_redemptions_active_customer_unique_idx",
  "discount_code_redemptions_application_unique_idx",
  "discount_code_redemptions_attempt_unique_idx",
]);

const getUniqueConstraint = (cause: unknown): string | undefined => {
  if (typeof cause !== "object" || cause === null) return undefined;
  if (
    "_tag" in cause &&
    cause._tag === "UniqueViolation" &&
    "constraint" in cause &&
    typeof cause.constraint === "string"
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
