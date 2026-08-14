import type { DotyposCustomerId } from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  CanonicalPromotionCode,
  DiscountCodeId,
  PromotionCodeId,
  StoredDiscountId,
  VoucherId,
} from "@/features/discounts/persistence-contracts";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import type { Locale } from "@/features/i18n";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";

export type DiscountLabels = Readonly<Record<Locale, string>>;

export const promotionCodeKinds = ["discount", "voucher"] as const;
export type PromotionCodeKind = (typeof promotionCodeKinds)[number];

export const discounts = pgTable(
  "discounts",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<StoredDiscountId>(),
    labels: jsonb("labels").notNull().$type<DiscountLabels>(),
    percentageBasisPoints: integer("percentage_basis_points"),
    fixedAmountValue: integer("fixed_amount_value"),
    fixedAmountExponent: integer("fixed_amount_exponent"),
    fixedAmountCurrency: text("fixed_amount_currency"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "discounts_adjustment_variant_check",
      sql`(
        ${t.percentageBasisPoints} is not null
        and ${t.fixedAmountValue} is null
        and ${t.fixedAmountExponent} is null
        and ${t.fixedAmountCurrency} is null
      ) or (
        ${t.percentageBasisPoints} is null
        and ${t.fixedAmountValue} is not null
        and ${t.fixedAmountExponent} is not null
        and ${t.fixedAmountCurrency} is not null
      )`
    ),
    check(
      "discounts_percentage_basis_points_check",
      sql`${t.percentageBasisPoints} is null or ${t.percentageBasisPoints} between 1 and 10000`
    ),
    check(
      "discounts_fixed_amount_check",
      sql`${t.fixedAmountValue} is null or (
        ${t.fixedAmountValue} > 0
        and ${t.fixedAmountExponent} >= 0
        and ${t.fixedAmountCurrency} ~ '^[A-Z]{3}$'
      )`
    ),
  ]
);

export const discountProductTargets = pgTable(
  "discount_targets",
  {
    discountId: text("discount_id")
      .notNull()
      .$type<StoredDiscountId>()
      .references(() => discounts.id, { onDelete: "cascade" }),
    productTarget: jsonb("product_target")
      .notNull()
      .$type<WorkspaceProductTarget>(),
  },
  (t) => [
    primaryKey({
      name: "discount_targets_pk",
      columns: [t.discountId, t.productTarget],
    }),
  ]
);

export const promotionCodes = pgTable(
  "promotion_codes",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<PromotionCodeId>(),
    kind: text("kind").notNull().$type<PromotionCodeKind>(),
    code: text("code").notNull().$type<CanonicalPromotionCode>(),
    enabled: boolean("enabled").notNull(),
    validFrom: instant("valid_from"),
    validUntil: instant("valid_until"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("promotion_codes_code_unique_idx").on(t.code),
    uniqueIndex("promotion_codes_id_kind_unique_idx").on(t.id, t.kind),
    check(
      "promotion_codes_code_check",
      sql`${t.code} ~ '^[A-Z0-9][A-Z0-9_-]{2,63}$'`
    ),
    check(
      "promotion_codes_valid_window_check",
      sql`${t.validFrom} is null or ${t.validUntil} is null or ${t.validUntil} > ${t.validFrom}`
    ),
    check(
      "promotion_codes_kind_check",
      sql`${t.kind} in ('discount', 'voucher')`
    ),
  ]
);

export const promotionCodeCustomers = pgTable(
  "promotion_code_customers",
  {
    promotionCodeId: text("promotion_code_id")
      .notNull()
      .$type<PromotionCodeId>()
      .references(() => promotionCodes.id, { onDelete: "cascade" }),
    dotyposCustomerId: text("dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
  },
  (t) => [
    primaryKey({
      name: "promotion_code_customers_pk",
      columns: [t.promotionCodeId, t.dotyposCustomerId],
    }),
    check(
      "promotion_code_customers_customer_check",
      sql`btrim(${t.dotyposCustomerId}) <> ''`
    ),
  ]
);

export const discountCodes = pgTable(
  "discount_codes",
  {
    id: text("id").primaryKey().default(postgresUuidV7).$type<DiscountCodeId>(),
    code: text("code").notNull().$type<CanonicalPromotionCode>(),
    enabled: boolean("enabled").notNull(),
    validFrom: instant("valid_from"),
    validUntil: instant("valid_until"),
    promotionCodeId: text("promotion_code_id")
      .notNull()
      .unique()
      .$type<PromotionCodeId>(),
    promotionKind: text("promotion_kind")
      .notNull()
      .default("discount")
      .$type<"discount">(),
    discountId: text("discount_id")
      .notNull()
      .$type<StoredDiscountId>()
      .references(() => discounts.id),
    maxUses: integer("max_uses"),
    maxUsesPerCustomer: integer("max_uses_per_customer"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("discount_codes_code_unique_idx").on(t.code),
    index("discount_codes_discount_idx").on(t.discountId),
    foreignKey({
      name: "discount_codes_promotion_fk",
      columns: [t.promotionCodeId, t.promotionKind],
      foreignColumns: [promotionCodes.id, promotionCodes.kind],
    }).onDelete("cascade"),
    check(
      "discount_codes_promotion_kind_check",
      sql`${t.promotionKind} = 'discount'`
    ),
    check(
      "discount_codes_code_check",
      sql`${t.code} ~ '^[A-Z0-9][A-Z0-9_-]{2,63}$'`
    ),
    check(
      "discount_codes_valid_window_check",
      sql`${t.validFrom} is null or ${t.validUntil} is null or ${t.validUntil} > ${t.validFrom}`
    ),
    check(
      "discount_codes_max_uses_check",
      sql`${t.maxUses} is null or ${t.maxUses} > 0`
    ),
    check(
      "discount_codes_max_uses_per_customer_check",
      sql`${t.maxUsesPerCustomer} is null or ${t.maxUsesPerCustomer} > 0`
    ),
  ]
);

export const discountCodeCustomers = pgTable(
  "discount_code_customers",
  {
    codeId: text("code_id")
      .notNull()
      .$type<DiscountCodeId>()
      .references(() => discountCodes.id, { onDelete: "cascade" }),
    dotyposCustomerId: text("dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
  },
  (t) => [
    primaryKey({
      name: "discount_code_customers_pk",
      columns: [t.codeId, t.dotyposCustomerId],
    }),
    check(
      "discount_code_customers_customer_check",
      sql`btrim(${t.dotyposCustomerId}) <> ''`
    ),
  ]
);

export const vouchers = pgTable(
  "vouchers",
  {
    id: text("id").primaryKey().default(postgresUuidV7).$type<VoucherId>(),
    promotionCodeId: text("promotion_code_id")
      .notNull()
      .unique()
      .$type<PromotionCodeId>(),
    promotionKind: text("promotion_kind")
      .notNull()
      .default("voucher")
      .$type<"voucher">(),
    issuedAmountValue: integer("issued_amount_value").notNull(),
    issuedAmountExponent: integer("issued_amount_exponent").notNull(),
    issuedAmountCurrency: text("issued_amount_currency").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({
      name: "vouchers_promotion_fk",
      columns: [t.promotionCodeId, t.promotionKind],
      foreignColumns: [promotionCodes.id, promotionCodes.kind],
    }).onDelete("cascade"),
    check("vouchers_promotion_kind_check", sql`${t.promotionKind} = 'voucher'`),
    check(
      "vouchers_issued_amount_check",
      sql`${t.issuedAmountValue} > 0 and ${t.issuedAmountExponent} >= 0 and ${t.issuedAmountCurrency} ~ '^[A-Z]{3}$'`
    ),
  ]
);

export type StoredDiscount = typeof discounts.$inferSelect;
export type NewStoredDiscount = typeof discounts.$inferInsert;
export type DiscountProductTarget = typeof discountProductTargets.$inferSelect;
export type NewDiscountProductTarget =
  typeof discountProductTargets.$inferInsert;
export type DiscountCode = typeof discountCodes.$inferSelect;
export type NewDiscountCode = typeof discountCodes.$inferInsert;
export type DiscountCodeCustomer = typeof discountCodeCustomers.$inferSelect;
export type NewDiscountCodeCustomer = typeof discountCodeCustomers.$inferInsert;
export type PromotionCode = typeof promotionCodes.$inferSelect;
export type NewPromotionCode = typeof promotionCodes.$inferInsert;
export type PromotionCodeCustomer = typeof promotionCodeCustomers.$inferSelect;
export type NewPromotionCodeCustomer =
  typeof promotionCodeCustomers.$inferInsert;
export type Voucher = typeof vouchers.$inferSelect;
export type NewVoucher = typeof vouchers.$inferInsert;
