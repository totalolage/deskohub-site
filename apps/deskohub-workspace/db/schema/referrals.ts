import type { DotyposCustomerId } from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type {
  DiscountApplicationId,
  PromotionCodeId,
} from "@/features/discounts/persistence-contracts";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { discountApplications } from "./discount-applications";
import { promotionCodes } from "./discounts";
import { quotedSqlList } from "./sql-list";

export const referralInvitationClaimStates = [
  "reserved",
  "redeemed",
  "released",
] as const;

export type ReferralInvitationClaimState =
  (typeof referralInvitationClaimStates)[number];

export const referralCodes = pgTable(
  "referral_codes",
  {
    promotionCodeId: text("promotion_code_id")
      .primaryKey()
      .$type<PromotionCodeId>(),
    promotionKind: text("promotion_kind")
      .notNull()
      .default("referral")
      .$type<"referral">(),
    referrerDotyposCustomerId: text("referrer_dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({
      name: "referral_codes_promotion_fk",
      columns: [t.promotionCodeId, t.promotionKind],
      foreignColumns: [promotionCodes.id, promotionCodes.kind],
    }).onDelete("cascade"),
    uniqueIndex("referral_codes_referrer_unique_idx").on(
      t.referrerDotyposCustomerId
    ),
    uniqueIndex("referral_codes_id_referrer_unique_idx").on(
      t.promotionCodeId,
      t.referrerDotyposCustomerId
    ),
    check(
      "referral_codes_promotion_kind_check",
      sql`${t.promotionKind} = 'referral'`
    ),
    check(
      "referral_codes_referrer_check",
      sql`btrim(${t.referrerDotyposCustomerId}) <> ''`
    ),
  ]
);

export const referralAttributions = pgTable(
  "referral_attributions",
  {
    invitedDotyposCustomerId: text("invited_dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
    referrerDotyposCustomerId: text("referrer_dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
    promotionCodeId: text("promotion_code_id")
      .notNull()
      .$type<PromotionCodeId>(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({
      name: "referral_attributions_invited_customer_pk",
      columns: [t.invitedDotyposCustomerId],
    }),
    index("referral_attributions_referrer_idx").on(t.referrerDotyposCustomerId),
    foreignKey({
      name: "referral_attributions_code_referrer_fk",
      columns: [t.promotionCodeId, t.referrerDotyposCustomerId],
      foreignColumns: [
        referralCodes.promotionCodeId,
        referralCodes.referrerDotyposCustomerId,
      ],
    }),
    check(
      "referral_attributions_customer_check",
      sql`btrim(${t.invitedDotyposCustomerId}) <> '' and btrim(${t.referrerDotyposCustomerId}) <> ''`
    ),
    check(
      "referral_attributions_self_check",
      sql`${t.invitedDotyposCustomerId} <> ${t.referrerDotyposCustomerId}`
    ),
  ]
);

export const referralInvitationClaims = pgTable(
  "referral_invitation_claims",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    invitedDotyposCustomerId: text("invited_dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>()
      .references(() => referralAttributions.invitedDotyposCustomerId),
    applicationId: text("application_id")
      .notNull()
      .$type<DiscountApplicationId>(),
    paymentAttemptId: text("payment_attempt_id")
      .notNull()
      .$type<PaymentAttemptId>(),
    state: text("state").notNull().$type<ReferralInvitationClaimState>(),
    reservationExpiresAt: instant("reservation_expires_at").notNull(),
    reservedAt: instant("reserved_at").notNull().default(sql`now()`),
    redeemedAt: instant("redeemed_at"),
    releasedAt: instant("released_at"),
    releaseReason: text("release_reason"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({
      name: "referral_invitation_claims_application_attempt_fk",
      columns: [t.applicationId, t.paymentAttemptId],
      foreignColumns: [
        discountApplications.id,
        discountApplications.paymentAttemptId,
      ],
    }),
    uniqueIndex("referral_invitation_claims_application_unique_idx").on(
      t.applicationId
    ),
    uniqueIndex("referral_invitation_claims_attempt_unique_idx").on(
      t.paymentAttemptId
    ),
    uniqueIndex("referral_invitation_claims_active_customer_unique_idx")
      .on(t.invitedDotyposCustomerId)
      .where(sql`${t.state} in ('reserved', 'redeemed')`),
    index("referral_invitation_claims_stale_reserved_idx")
      .on(t.reservationExpiresAt)
      .where(sql`${t.state} = 'reserved'`),
    check(
      "referral_invitation_claims_customer_check",
      sql`btrim(${t.invitedDotyposCustomerId}) <> ''`
    ),
    check(
      "referral_invitation_claims_state_check",
      sql`${t.state} in (${quotedSqlList(referralInvitationClaimStates)})`
    ),
    check(
      "referral_invitation_claims_expiration_check",
      sql`${t.reservationExpiresAt} > ${t.reservedAt}`
    ),
    check(
      "referral_invitation_claims_lifecycle_check",
      sql`(
        ${t.state} = 'reserved'
        and ${t.redeemedAt} is null
        and ${t.releasedAt} is null
        and ${t.releaseReason} is null
      ) or (
        ${t.state} = 'redeemed'
        and ${t.redeemedAt} is not null
        and ${t.releasedAt} is null
        and ${t.releaseReason} is null
      ) or (
        ${t.state} = 'released'
        and ${t.redeemedAt} is null
        and ${t.releasedAt} is not null
        and ${t.releaseReason} is not null
        and btrim(${t.releaseReason}) <> ''
      )`
    ),
  ]
);
