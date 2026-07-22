import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import type {
  CanonicalDiscountCode,
  DiscountCodeId,
  StoredDiscountId,
} from "@/features/discounts/persistence-contracts";
import type { Locale } from "@/features/i18n";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";

export type DiscountLabels = Readonly<Record<Locale, string>>;

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
  "discount_product_targets",
  {
    discountId: text("discount_id")
      .notNull()
      .$type<StoredDiscountId>()
      .references(() => discounts.id, { onDelete: "cascade" }),
    productIdentity: jsonb("product_identity")
      .notNull()
      .$type<WorkspaceProductIdentity>(),
  },
  (t) => [
    primaryKey({
      name: "discount_product_targets_pk",
      columns: [t.discountId, t.productIdentity],
    }),
  ]
);

export const discountCodes = pgTable(
  "discount_codes",
  {
    id: text("id").primaryKey().default(postgresUuidV7).$type<DiscountCodeId>(),
    discountId: text("discount_id")
      .notNull()
      .$type<StoredDiscountId>()
      .references(() => discounts.id),
    code: text("code").notNull().$type<CanonicalDiscountCode>(),
    enabled: boolean("enabled").notNull(),
    validFrom: instant("valid_from"),
    validUntil: instant("valid_until"),
    maxUses: integer("max_uses"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("discount_codes_code_unique_idx").on(t.code),
    index("discount_codes_discount_idx").on(t.discountId),
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
  ]
);

export const discountCodeCustomers = pgTable(
  "discount_code_customers",
  {
    codeId: text("code_id")
      .notNull()
      .$type<DiscountCodeId>()
      .references(() => discountCodes.id, { onDelete: "cascade" }),
    dotyposCustomerId: text("dotypos_customer_id").notNull(),
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

export type StoredDiscount = typeof discounts.$inferSelect;
export type NewStoredDiscount = typeof discounts.$inferInsert;
export type DiscountProductTarget = typeof discountProductTargets.$inferSelect;
export type NewDiscountProductTarget =
  typeof discountProductTargets.$inferInsert;
export type DiscountCode = typeof discountCodes.$inferSelect;
export type NewDiscountCode = typeof discountCodes.$inferInsert;
export type DiscountCodeCustomer = typeof discountCodeCustomers.$inferSelect;
export type NewDiscountCodeCustomer = typeof discountCodeCustomers.$inferInsert;
