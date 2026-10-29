import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase, WorkspaceTransaction } from "@/db/database.service";
import { promotionCodes } from "@/db/schema/discounts";
import {
  type ReferralSignupOutcome,
  referralAttributions,
  referralCodes,
  referralSignupIntents,
} from "@/db/schema/referrals";
import type { CustomerAccountId } from "@/features/account/customer-account";
import {
  canonicalPromotionCodeSchema,
  type PromotionCodeId,
} from "@/features/discounts/persistence-contracts";
import type { ReferralCode } from "./client";

/** The referral code a first-time profile completion asked to record. */
export type ReferralSignupIntent = {
  readonly promotionCodeId: PromotionCodeId;
  readonly referrerDotyposCustomerId: DotyposCustomerId;
};

/**
 * A stored intent with the code text that acceptance takes. `outcome` is
 * empty while it still waits to be recorded.
 */
type StoredReferralSignupIntent = ReferralSignupIntent & {
  readonly code: string;
  readonly outcome: ReferralSignupOutcome | null;
  readonly acknowledged: boolean;
};

type ReferralSignupIntentError = EffectDrizzleQueryError | SqlError;

/**
 * Writes the intent in the caller's transaction, so it commits or rolls back
 * with the customer link that the same completion created. Selecting from the
 * code registry instead of inserting values means a code deleted since it was
 * checked writes nothing rather than failing the link.
 */
export const insertReferralSignupIntent = (
  customerAccountId: CustomerAccountId,
  intent: ReferralSignupIntent
) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .insert(referralSignupIntents)
      .select(
        db
          .select({
            customerAccountId: sql<string>`${customerAccountId}`.as(
              "customer_account_id"
            ),
            promotionCodeId: referralCodes.promotionCodeId,
            referrerDotyposCustomerId: referralCodes.referrerDotyposCustomerId,
          })
          .from(referralCodes)
          .where(
            and(
              eq(referralCodes.promotionCodeId, intent.promotionCodeId),
              eq(
                referralCodes.referrerDotyposCustomerId,
                intent.referrerDotyposCustomerId
              )
            )
          )
      )
      .onConflictDoNothing()
      .pipe(Effect.asVoid)
  );

interface IReferralSignupIntentRepository {
  /** The registry identity of a code that was just checked as available. */
  readonly findCodeTarget: (
    code: ReferralCode
  ) => Effect.Effect<
    ReferralSignupIntent | undefined,
    ReferralSignupIntentError
  >;
  readonly find: (
    customerAccountId: CustomerAccountId
  ) => Effect.Effect<
    StoredReferralSignupIntent | undefined,
    ReferralSignupIntentError
  >;
  /**
   * Records the outcome of a still-unsettled intent that names the given
   * code. Only one caller can settle it; the others get `false`.
   */
  readonly settle: (
    customerAccountId: CustomerAccountId,
    promotionCodeId: PromotionCodeId,
    outcome: ReferralSignupOutcome
  ) => Effect.Effect<boolean, ReferralSignupIntentError>;
  /** Hides a settled outcome from the account for good. */
  readonly acknowledge: (
    customerAccountId: CustomerAccountId
  ) => Effect.Effect<void, ReferralSignupIntentError>;
  /** The code a customer's permanent attribution came from, if any. */
  readonly findAttributedCode: (
    invitedDotyposCustomerId: DotyposCustomerId
  ) => Effect.Effect<PromotionCodeId | undefined, ReferralSignupIntentError>;
}

export class ReferralSignupIntentRepository extends Context.Service<
  ReferralSignupIntentRepository,
  IReferralSignupIntentRepository
>()("@deskohub-workspace/referrals/ReferralSignupIntentRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const findCodeTarget = Effect.fn(
        "ReferralSignupIntentRepository.findCodeTarget"
      )((code: ReferralCode) =>
        db
          .select({
            promotionCodeId: referralCodes.promotionCodeId,
            referrerDotyposCustomerId: referralCodes.referrerDotyposCustomerId,
          })
          .from(referralCodes)
          .innerJoin(
            promotionCodes,
            eq(promotionCodes.id, referralCodes.promotionCodeId)
          )
          .where(
            and(
              eq(promotionCodes.code, canonicalPromotionCodeSchema.make(code)),
              eq(promotionCodes.kind, "referral")
            )
          )
          .limit(1)
          .pipe(Effect.map(([target]) => target))
      );

      const find = Effect.fn("ReferralSignupIntentRepository.find")(
        (customerAccountId: CustomerAccountId) =>
          db
            .select({
              code: promotionCodes.code,
              promotionCodeId: referralSignupIntents.promotionCodeId,
              referrerDotyposCustomerId:
                referralSignupIntents.referrerDotyposCustomerId,
              outcome: referralSignupIntents.outcome,
              acknowledgedAt: referralSignupIntents.acknowledgedAt,
            })
            .from(referralSignupIntents)
            .innerJoin(
              promotionCodes,
              eq(promotionCodes.id, referralSignupIntents.promotionCodeId)
            )
            .where(
              eq(referralSignupIntents.customerAccountId, customerAccountId)
            )
            .limit(1)
            .pipe(
              Effect.map(([row]) => {
                if (!row) return undefined;
                const { acknowledgedAt, ...intent } = row;
                return {
                  ...intent,
                  acknowledged: acknowledgedAt !== null,
                } satisfies StoredReferralSignupIntent;
              })
            )
      );

      const settle = Effect.fn("ReferralSignupIntentRepository.settle")(
        (
          customerAccountId: CustomerAccountId,
          promotionCodeId: PromotionCodeId,
          outcome: ReferralSignupOutcome
        ) =>
          db
            .update(referralSignupIntents)
            .set({ outcome, settledAt: Temporal.Now.instant() })
            .where(
              and(
                eq(referralSignupIntents.customerAccountId, customerAccountId),
                eq(referralSignupIntents.promotionCodeId, promotionCodeId),
                isNull(referralSignupIntents.settledAt)
              )
            )
            .returning({
              customerAccountId: referralSignupIntents.customerAccountId,
            })
            .pipe(Effect.map((rows) => rows.length > 0))
      );

      const acknowledge = Effect.fn(
        "ReferralSignupIntentRepository.acknowledge"
      )((customerAccountId: CustomerAccountId) =>
        db
          .update(referralSignupIntents)
          .set({ acknowledgedAt: Temporal.Now.instant() })
          .where(
            and(
              eq(referralSignupIntents.customerAccountId, customerAccountId),
              isNotNull(referralSignupIntents.settledAt),
              isNull(referralSignupIntents.acknowledgedAt)
            )
          )
          .pipe(Effect.asVoid)
      );

      const findAttributedCode = Effect.fn(
        "ReferralSignupIntentRepository.findAttributedCode"
      )((invitedDotyposCustomerId: DotyposCustomerId) =>
        db
          .select({ promotionCodeId: referralAttributions.promotionCodeId })
          .from(referralAttributions)
          .where(
            eq(
              referralAttributions.invitedDotyposCustomerId,
              invitedDotyposCustomerId
            )
          )
          .limit(1)
          .pipe(Effect.map(([attribution]) => attribution?.promotionCodeId))
      );

      return {
        findCodeTarget,
        find,
        settle,
        acknowledge,
        findAttributedCode,
      } satisfies IReferralSignupIntentRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
