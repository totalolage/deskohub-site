import { and, count, eq, inArray, lte } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
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
  getDiscountCommitmentPayload,
} from "@/features/discounts/commitment";
import type {
  AppliedDiscount,
  DiscountAdjustment,
} from "@/features/discounts/contracts";
import { decodeDiscountDefinition } from "@/features/discounts/discount-definition";
import { DiscountClaimError } from "@/features/discounts/errors";
import type { DiscountApplicationId } from "@/features/discounts/persistence-contracts";
import type { DiscountClaimInstruction } from "@/features/discounts/provider";
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

export type PaymentLifecycleRepositoryError =
  | DiscountClaimError
  | EffectDrizzleQueryError
  | PaymentLifecycleStateError
  | SqlError;

export interface IPaymentLifecycleRepository {
  readonly createAttempt: (input: {
    readonly workspaceReservationId: string;
    readonly providerOrderId: string;
    readonly amount: WorkspaceMoney;
    readonly commitment: DiscountCommitment;
  }) => Effect.Effect<PaymentAttempt, PaymentLifecycleRepositoryError>;
  readonly attachProviderSession: (input: {
    readonly id: string;
    readonly securityToken: string;
    readonly providerRedirectUrl: string;
  }) => Effect.Effect<
    PaymentAttempt,
    EffectDrizzleQueryError | PaymentLifecycleStateError
  >;
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

      const createAttempt = Effect.fn(
        "PaymentLifecycleRepository.createAttempt"
      )(function* (input: {
        readonly workspaceReservationId: string;
        readonly providerOrderId: string;
        readonly amount: WorkspaceMoney;
        readonly commitment: DiscountCommitment;
      }) {
        const commitment = getDiscountCommitmentPayload(input.commitment);
        const claimedApplication =
          yield* validateDiscountCommitment(commitment);
        const now = Temporal.Now.instant();

        return yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const [reservation] = yield* tx
                .select({
                  id: workspaceReservations.id,
                  dotyposCustomerId: workspaceReservations.dotyposCustomerId,
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

              if (
                !reservation?.reservationHoldExpiresAt ||
                Temporal.Instant.compare(
                  reservation.reservationHoldExpiresAt,
                  now
                ) <= 0
              ) {
                return yield* new PaymentLifecycleStateError({
                  operation: "PaymentLifecycleRepository.createAttempt",
                  paymentAttemptId: input.providerOrderId,
                  message:
                    "Payment attempts can only be created for a current held reservation.",
                });
              }

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
                  operation: "PaymentLifecycleRepository.createAttempt",
                  paymentAttemptId: attemptRow.id,
                  message:
                    "Payment attempts can only be linked to held unpaid reservations.",
                });
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
                            workspaceReservationId:
                              input.workspaceReservationId,
                            sequence,
                            publicDiscountId: application.discount.id,
                            label: application.discount.label,
                            adjustment: application.discount.adjustment,
                            productIdentity: commitment.product,
                            subtotalBeforeValue:
                              application.subtotalBefore.value,
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
                  (application) =>
                    application.sequence === claimedApplication.index
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
                  reservationCustomerId: reservation.dotyposCustomerId,
                  reservationExpiresAt: reservation.reservationHoldExpiresAt,
                  now,
                });
              }

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

      const attachProviderSession = Effect.fn(
        "PaymentLifecycleRepository.attachProviderSession"
      )(function* (input: {
        readonly id: string;
        readonly securityToken: string;
        readonly providerRedirectUrl: string;
      }) {
        const [attempt] = yield* db
          .update(paymentAttempts)
          .set({
            state: "pending",
            securityToken: input.securityToken,
            providerRedirectUrl: input.providerRedirectUrl,
            updatedAt: Temporal.Now.instant(),
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
            paymentAttemptId: input.id,
            message:
              "Only created payment attempts can attach a provider session.",
          });
        }

        return toPaymentAttempt(attempt);
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
        createAttempt,
        attachProviderSession,
        markPaid,
        markTerminal,
      } satisfies IPaymentLifecycleRepository;
    })
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
    readonly reservationCustomerId: string;
    readonly reservationExpiresAt: Temporal.Instant;
    readonly now: Temporal.Instant;
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
    if (
      code.validFrom &&
      Temporal.Instant.compare(input.now, code.validFrom) < 0
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
      Temporal.Instant.compare(input.now, code.validUntil) >= 0
    ) {
      return yield* claimError(
        "reserve",
        "expired",
        "The accepted discount code has expired.",
        input.claim
      );
    }

    yield* input.tx
      .update(discountCodeRedemptions)
      .set({
        state: "released",
        releasedAt: input.now,
        releaseReason: "reservation_expired_before_reuse",
        updatedAt: input.now,
      })
      .where(
        and(
          eq(discountCodeRedemptions.codeId, input.claim.codeId),
          eq(discountCodeRedemptions.state, "reserved"),
          lte(discountCodeRedemptions.reservationExpiresAt, input.now)
        )
      );

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
    if (
      !discountAdjustmentsEqual(
        currentDefinition.adjustment,
        input.application.discount.adjustment
      ) ||
      !Object.values(currentDefinition.labels).includes(
        input.application.discount.label
      )
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
      reservedAt: input.now,
      updatedAt: input.now,
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
