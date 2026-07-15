import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { DiscountId } from "@/features/discounts";
import type {
  DiscountApplicationId,
  DiscountCodeClaimId,
  DiscountCodeId,
} from "@/features/discounts/persistence-contracts";
import { postgresUuidV7 } from "../uuid-v7";
import { discountCodes } from "./discounts";
import { paymentAttempts } from "./payment-attempts";
import { quotedSqlList } from "./sql-list";
import { workspaceReservations } from "./workspace-reservations";

export const discountCodeClaimStates = [
  "reserved",
  "redeemed",
  "released",
] as const;

export type DiscountCodeClaimState = (typeof discountCodeClaimStates)[number];

export const discountApplications = pgTable(
  "discount_applications",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<DiscountApplicationId>(),
    paymentAttemptId: text("payment_attempt_id")
      .notNull()
      .references(() => paymentAttempts.id),
    workspaceReservationId: text("workspace_reservation_id")
      .notNull()
      .references(() => workspaceReservations.id),
    sequence: integer("sequence").notNull(),
    publicDiscountId: text("public_discount_id").notNull().$type<DiscountId>(),
    label: text("label").notNull(),
    adjustment: jsonb("adjustment").notNull().$type<unknown>(),
    productIdentity: jsonb("product_identity").notNull().$type<unknown>(),
    subtotalBeforeValue: integer("subtotal_before_value").notNull(),
    subtotalBeforeExponent: integer("subtotal_before_exponent").notNull(),
    subtotalBeforeCurrency: text("subtotal_before_currency").notNull(),
    appliedAmountValue: integer("applied_amount_value").notNull(),
    appliedAmountExponent: integer("applied_amount_exponent").notNull(),
    appliedAmountCurrency: text("applied_amount_currency").notNull(),
    subtotalAfterValue: integer("subtotal_after_value").notNull(),
    subtotalAfterExponent: integer("subtotal_after_exponent").notNull(),
    subtotalAfterCurrency: text("subtotal_after_currency").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    countdownStartsAt: timestamp("countdown_starts_at", {
      withTimezone: true,
      mode: "date",
    }),
    provenance: jsonb("provenance").notNull().$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("discount_applications_attempt_sequence_unique_idx").on(
      t.paymentAttemptId,
      t.sequence
    ),
    index("discount_applications_reservation_idx").on(t.workspaceReservationId),
    check("discount_applications_sequence_check", sql`${t.sequence} >= 0`),
    check(
      "discount_applications_identity_check",
      sql`btrim(${t.publicDiscountId}) <> '' and btrim(${t.label}) <> ''`
    ),
    check(
      "discount_applications_money_values_check",
      sql`${t.subtotalBeforeValue} > 0
        and ${t.appliedAmountValue} > 0
        and ${t.subtotalAfterValue} >= 0
        and ${t.subtotalBeforeValue} - ${t.appliedAmountValue} = ${t.subtotalAfterValue}`
    ),
    check(
      "discount_applications_money_exponents_check",
      sql`${t.subtotalBeforeExponent} >= 0
        and ${t.subtotalBeforeExponent} = ${t.appliedAmountExponent}
        and ${t.subtotalBeforeExponent} = ${t.subtotalAfterExponent}`
    ),
    check(
      "discount_applications_money_currencies_check",
      sql`${t.subtotalBeforeCurrency} ~ '^[A-Z]{3}$'
        and ${t.subtotalBeforeCurrency} = ${t.appliedAmountCurrency}
        and ${t.subtotalBeforeCurrency} = ${t.subtotalAfterCurrency}`
    ),
    check(
      "discount_applications_countdown_check",
      sql`${t.countdownStartsAt} is null or (
        ${t.expiresAt} is not null and ${t.countdownStartsAt} < ${t.expiresAt}
      )`
    ),
  ]
);

export const discountCodeRedemptions = pgTable(
  "discount_code_redemptions",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<DiscountCodeClaimId>(),
    codeId: text("code_id")
      .notNull()
      .$type<DiscountCodeId>()
      .references(() => discountCodes.id),
    applicationId: text("application_id")
      .notNull()
      .$type<DiscountApplicationId>()
      .references(() => discountApplications.id),
    paymentAttemptId: text("payment_attempt_id")
      .notNull()
      .references(() => paymentAttempts.id),
    dotyposCustomerId: text("dotypos_customer_id").notNull(),
    state: text("state").notNull().$type<DiscountCodeClaimState>(),
    reservationExpiresAt: timestamp("reservation_expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    reservedAt: timestamp("reserved_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    redeemedAt: timestamp("redeemed_at", {
      withTimezone: true,
      mode: "date",
    }),
    releasedAt: timestamp("released_at", {
      withTimezone: true,
      mode: "date",
    }),
    releaseReason: text("release_reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("discount_code_redemptions_application_unique_idx").on(
      t.applicationId
    ),
    uniqueIndex("discount_code_redemptions_attempt_unique_idx").on(
      t.paymentAttemptId
    ),
    uniqueIndex("discount_code_redemptions_active_customer_unique_idx")
      .on(t.codeId, t.dotyposCustomerId)
      .where(sql`${t.state} in ('reserved', 'redeemed')`),
    index("discount_code_redemptions_code_state_idx").on(t.codeId, t.state),
    index("discount_code_redemptions_stale_reserved_idx")
      .on(t.reservationExpiresAt)
      .where(sql`${t.state} = 'reserved'`),
    check(
      "discount_code_redemptions_customer_check",
      sql`btrim(${t.dotyposCustomerId}) <> ''`
    ),
    check(
      "discount_code_redemptions_state_check",
      sql`${t.state} in (${quotedSqlList(discountCodeClaimStates)})`
    ),
    check(
      "discount_code_redemptions_expiration_check",
      sql`${t.reservationExpiresAt} > ${t.reservedAt}`
    ),
    check(
      "discount_code_redemptions_lifecycle_check",
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

export type DiscountApplication = typeof discountApplications.$inferSelect;
export type NewDiscountApplication = typeof discountApplications.$inferInsert;
export type DiscountCodeRedemption =
  typeof discountCodeRedemptions.$inferSelect;
export type NewDiscountCodeRedemption =
  typeof discountCodeRedemptions.$inferInsert;
