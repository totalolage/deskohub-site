import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { Effect } from "effect";
import "../../shared/polyfills/temporal";
import {
  discountApplications,
  paymentAttempts,
  promotionCodes,
  referralAttributions,
  referralCodes,
  referralInvitationClaims,
  workspaceReservations,
} from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import { customerAccounts } from "@/db/schema/customer-accounts";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import {
  checkoutAttemptKeySchema,
  checkoutSessionKeySchema,
} from "@/features/checkout/checkout-identifiers";
import { canonicalPromotionCodeSchema } from "@/features/discounts/contracts";
import { parseReferralCode } from "@/features/referrals/client";
import { getReferralReferrerDiscountId } from "@/features/referrals/discount-identifiers";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";
import type { DatabaseClient } from "../../db/database-client";
import type { WorkspaceE2EError } from "../errors";
import { workspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import { addRedaction } from "../runtime";
import { seedWorkspaceE2EReservationAuthor } from "./auth-rows";

export type WorkspaceE2EReferralOwnerInput = {
  readonly accountId: string;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly email: string;
  readonly name: string;
};

type ReferralPromotionCodeId =
  (typeof referralCodes.$inferSelect)["promotionCodeId"];

export type WorkspaceE2EReferralOwner = {
  readonly code: string;
  readonly promotionCodeId: ReferralPromotionCodeId;
};

type DatabaseTransaction = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

const generateReferralCode = () => {
  const value = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
  return `RFL${value.toUpperCase()}`;
};

const insertReferralCode = Effect.fn("seedWorkspaceE2EReferralCode")(function* (
  tx: DatabaseTransaction,
  referrerDotyposCustomerId: DotyposCustomerId
) {
  const code = parseReferralCode(generateReferralCode());
  if (code === undefined) {
    return yield* workspaceE2EError(
      "generated referral fixture code is invalid",
      {
        diagnosticCode: "postgres_account_fixture_assertion_failed",
        operation: "validate referral fixture code",
      }
    );
  }

  const [promotion] = yield* tx
    .insert(promotionCodes)
    .values({
      code: sensitiveDatabaseParameter(canonicalPromotionCodeSchema.make(code)),
      enabled: true,
      kind: "referral",
      validFrom: null,
      validUntil: null,
    })
    .returning({ id: promotionCodes.id });
  if (!promotion) {
    return yield* workspaceE2EError(
      "referral promotion insert returned no row",
      {
        diagnosticCode: "postgres_account_fixture_assertion_failed",
        operation: "insert referral promotion",
      }
    );
  }

  const [referral] = yield* tx
    .insert(referralCodes)
    .values({
      promotionCodeId: promotion.id,
      promotionKind: "referral",
      referrerDotyposCustomerId,
    })
    .returning({ promotionCodeId: referralCodes.promotionCodeId });
  if (!referral) {
    return yield* workspaceE2EError("referral code insert returned no row", {
      diagnosticCode: "postgres_account_fixture_assertion_failed",
      operation: "insert referral code",
    });
  }

  return {
    code,
    promotionCodeId: referral.promotionCodeId,
  } satisfies WorkspaceE2EReferralOwner;
});

/**
 * A referral code is usable only while its owner's linked customer account
 * joins an active auth user, so every seeded owner gets both rows with its
 * code.
 */
const insertReferralOwner = Effect.fn("seedWorkspaceE2EReferralOwner")(
  function* (tx: DatabaseTransaction, owner: WorkspaceE2EReferralOwnerInput) {
    yield* tx.insert(customerAccounts).values({
      id: customerAccountIdSchema.make(owner.accountId),
      dotyposCustomerId: owner.dotyposCustomerId,
    });
    yield* tx.insert(authUser).values({
      deletionRequestedAt: null,
      email: sensitiveDatabaseParameter(owner.email),
      emailVerified: true,
      id: owner.accountId,
      name: owner.name,
    });
    return yield* insertReferralCode(tx, owner.dotyposCustomerId);
  }
);

/**
 * Local paid-booking evidence is keyed by this prefix, so cleanup removes only
 * the rows a fixture seeded for its journaled synthetic customers.
 */
const seededReservationIdPrefix = "account-referral-history-";

const makePaidHistoryRow = (input: {
  readonly authorAccountId: CustomerAccountId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly dotyposReservationId: DotyposReservationId;
  readonly paidAt: Date;
}): typeof workspaceReservations.$inferInsert => {
  const paidAt = Temporal.Instant.fromEpochMilliseconds(input.paidAt.getTime());
  return {
    authorAccountId: input.authorAccountId,
    checkoutAttemptKey: checkoutAttemptKeySchema.make(
      `account-referral-attempt-${crypto.randomUUID()}`
    ),
    checkoutSessionKey: checkoutSessionKeySchema.make(
      `account-referral-session-${crypto.randomUUID()}`
    ),
    dotyposCustomerId: input.dotyposCustomerId,
    dotyposReservationId: input.dotyposReservationId,
    fulfillmentState: "not_started",
    id: workspaceReservationIdSchema.make(
      `${seededReservationIdPrefix}${crypto.randomUUID()}`
    ),
    locale: "en-US",
    paidAt,
    paymentState: "paid",
    reservationConfirmedAt: paidAt,
    reservationCreatedAt: paidAt,
    reservationDetails: {
      coffee: false,
      entryTier: "basic",
      kind: "cowork",
    },
    reservationState: "confirmed",
  };
};

export type WorkspaceE2EReferralInviteeInput = {
  readonly invitedDotyposCustomerId: DotyposCustomerId;
  /** A finished confirmed Dotypos visit that makes the invitee eligible. */
  readonly paidVisit?: {
    readonly dotyposReservationId: DotyposReservationId;
    readonly endedAt: Date;
  };
  readonly referrerDotyposCustomerId: DotyposCustomerId;
  readonly referrerPromotionCodeId: ReferralPromotionCodeId;
};

/**
 * Attributes one synthetic invitee to a referrer and, for an eligible
 * invitee, records the local paid booking that matches its Dotypos visit.
 */
export const seedWorkspaceE2EReferralInvitee = (
  input: WorkspaceE2EReferralInviteeInput
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    yield* runDatabaseOperation(
      "seed synthetic referral invitee",
      db.transaction(
        Effect.fn(function* (tx) {
          yield* tx.insert(referralAttributions).values({
            invitedDotyposCustomerId: input.invitedDotyposCustomerId,
            promotionCodeId: input.referrerPromotionCodeId,
            referrerDotyposCustomerId: input.referrerDotyposCustomerId,
          });
          if (input.paidVisit) {
            yield* tx.insert(workspaceReservations).values(
              makePaidHistoryRow({
                authorAccountId: yield* seedWorkspaceE2EReservationAuthor(
                  tx,
                  input.invitedDotyposCustomerId
                ),
                dotyposCustomerId: input.invitedDotyposCustomerId,
                dotyposReservationId: input.paidVisit.dotyposReservationId,
                paidAt: input.paidVisit.endedAt,
              })
            );
          }
        })
      )
    );
  });

/**
 * Records one paid booking of the referrer that used the referrer discount,
 * so the Referrals screen has savings to show.
 */
export const seedWorkspaceE2EReferrerSavings = (input: {
  readonly dotyposReservationId: DotyposReservationId;
  readonly paidAt: Date;
  readonly referrerDotyposCustomerId: DotyposCustomerId;
  readonly saved: { readonly value: number; readonly subtotal: number };
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const paidAmount = input.saved.subtotal - input.saved.value;
    yield* runDatabaseOperation(
      "seed synthetic referrer savings",
      db.transaction(
        Effect.fn(function* (tx) {
          const reservation = makePaidHistoryRow({
            authorAccountId: yield* seedWorkspaceE2EReservationAuthor(
              tx,
              input.referrerDotyposCustomerId
            ),
            dotyposCustomerId: input.referrerDotyposCustomerId,
            dotyposReservationId: input.dotyposReservationId,
            paidAt: input.paidAt,
          });
          yield* tx.insert(workspaceReservations).values(reservation);
          const [attempt] = yield* tx
            .insert(paymentAttempts)
            .values({
              amountExponent: 2,
              amountValue: paidAmount,
              currency: "CZK",
              provider: "nexi",
              providerOrderId: NexiOrderIdSchema.make(
                `e2e-referral-savings-${crypto.randomUUID()}`
              ),
              state: "paid",
              workspaceReservationId: reservation.id!,
            })
            .returning({ id: paymentAttempts.id });
          if (!attempt) {
            return yield* workspaceE2EError(
              "referrer savings payment insert returned no row",
              {
                diagnosticCode: "postgres_account_fixture_assertion_failed",
                operation: "insert referrer savings payment",
              }
            );
          }
          yield* tx.insert(discountApplications).values({
            adjustment: { basisPoints: 500, kind: "percentage" },
            appliedAmountCurrency: "CZK",
            appliedAmountExponent: 2,
            appliedAmountValue: input.saved.value,
            label: "Referral discount",
            paymentAttemptId: attempt.id,
            productIdentity: { kind: "cowork" },
            provenance: { inviteeCount: 1, kind: "referral-referrer" },
            publicDiscountId: getReferralReferrerDiscountId(
              input.referrerDotyposCustomerId
            ),
            sequence: 0,
            subtotalAfterCurrency: "CZK",
            subtotalAfterExponent: 2,
            subtotalAfterValue: paidAmount,
            subtotalBeforeCurrency: "CZK",
            subtotalBeforeExponent: 2,
            subtotalBeforeValue: input.saved.subtotal,
            workspaceReservationId: reservation.id!,
          });
        })
      )
    );
  });

/** Reads the active invitation claim of one invited customer, if any. */
export const findWorkspaceE2EReferralInvitationClaimState = (
  invitedDotyposCustomerId: DotyposCustomerId
): Effect.Effect<string | undefined, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runDatabaseOperation(
      "read synthetic referral invitation claim",
      db
        .select({ state: referralInvitationClaims.state })
        .from(referralInvitationClaims)
        .where(
          and(
            eq(
              referralInvitationClaims.invitedDotyposCustomerId,
              invitedDotyposCustomerId
            ),
            inArray(referralInvitationClaims.state, ["reserved", "redeemed"])
          )
        )
        .limit(1)
    );
    return rows[0]?.state;
  });

/**
 * Seeds the referrer whose share link the synthetic main account follows
 * before completing its profile.
 */
export const seedWorkspaceE2EReferralOwner = (
  input: WorkspaceE2EReferralOwnerInput
): Effect.Effect<WorkspaceE2EReferralOwner, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    return yield* runDatabaseOperation(
      "seed synthetic referral owner",
      db.transaction((tx) => insertReferralOwner(tx, input))
    );
  }).pipe(
    Effect.mapError((cause) =>
      workspaceE2EError("Could not seed synthetic referral owner", {
        cause,
        diagnosticCode: "postgres_account_fixture_assertion_failed",
        operation: "seed synthetic referral owner",
      })
    )
  );

/** Reads the referrer recorded for one invited customer, if any. */
export const findWorkspaceE2EReferralReferrer = (
  invitedDotyposCustomerId: DotyposCustomerId
): Effect.Effect<string | undefined, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runDatabaseOperation(
      "read synthetic referral attribution",
      db
        .select({
          referrerDotyposCustomerId:
            referralAttributions.referrerDotyposCustomerId,
        })
        .from(referralAttributions)
        .where(
          eq(
            referralAttributions.invitedDotyposCustomerId,
            invitedDotyposCustomerId
          )
        )
        .limit(1)
    );
    return rows[0]?.referrerDotyposCustomerId;
  });

export const removeWorkspaceE2EReferralRows = (input: {
  readonly syntheticDotyposCustomerIds: readonly DotyposCustomerId[];
  readonly syntheticDotyposReservationIds: readonly DotyposReservationId[];
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    if (
      input.syntheticDotyposCustomerIds.length === 0 &&
      input.syntheticDotyposReservationIds.length === 0
    ) {
      return;
    }

    const { db } = yield* E2EDatabase;
    yield* runDatabaseOperation(
      "remove synthetic account referral rows",
      removeReferralFixtureRows(db, input)
    );
  });

const removeReferralFixtureRows = (
  db: DatabaseClient,
  input: {
    readonly syntheticDotyposCustomerIds: readonly DotyposCustomerId[];
    readonly syntheticDotyposReservationIds: readonly DotyposReservationId[];
  }
) =>
  db.transaction(
    Effect.fn(function* (tx) {
      const customerIds = input.syntheticDotyposCustomerIds;
      if (customerIds.length > 0) {
        const codes = yield* tx
          .select({ promotionCodeId: referralCodes.promotionCodeId })
          .from(referralCodes)
          .where(inArray(referralCodes.referrerDotyposCustomerId, customerIds));
        yield* tx
          .delete(referralInvitationClaims)
          .where(
            inArray(
              referralInvitationClaims.invitedDotyposCustomerId,
              customerIds
            )
          );
        yield* tx
          .delete(referralAttributions)
          .where(
            or(
              inArray(
                referralAttributions.invitedDotyposCustomerId,
                customerIds
              ),
              inArray(
                referralAttributions.referrerDotyposCustomerId,
                customerIds
              )
            )
          );
        yield* tx
          .delete(referralCodes)
          .where(inArray(referralCodes.referrerDotyposCustomerId, customerIds));
        const promotionCodeIds = codes.map(
          ({ promotionCodeId }) => promotionCodeId
        );
        if (promotionCodeIds.length > 0) {
          yield* tx
            .delete(promotionCodes)
            .where(inArray(promotionCodes.id, promotionCodeIds));
        }
        const seeded = yield* tx
          .select({ id: workspaceReservations.id })
          .from(workspaceReservations)
          .where(
            and(
              inArray(workspaceReservations.dotyposCustomerId, customerIds),
              like(workspaceReservations.id, `${seededReservationIdPrefix}%`)
            )
          );
        const seededIds = seeded.map(({ id }) => id);
        if (seededIds.length > 0) {
          yield* tx
            .delete(discountApplications)
            .where(
              inArray(discountApplications.workspaceReservationId, seededIds)
            );
          yield* tx
            .delete(workspaceReservations)
            .where(inArray(workspaceReservations.id, seededIds));
        }
      }

      if (input.syntheticDotyposReservationIds.length > 0) {
        yield* tx
          .delete(workspaceReservations)
          .where(
            inArray(
              workspaceReservations.dotyposReservationId,
              input.syntheticDotyposReservationIds
            )
          );
      }
    })
  );

/**
 * A well-formed referral code that no run ever seeds, registered with the
 * redactor. Pages and checkouts carrying it must behave as if it were absent.
 */
export const makeUnusableReferralCode = () => {
  const code = `RFL${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)
    .toUpperCase()}`;
  addRedaction(code, true);
  return code;
};
