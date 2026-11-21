import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import {
  type WorkspaceProductMonitorOption,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import type { Locale } from "@/features/i18n";
import type { OrderId } from "@/features/order";
import { type PassStatus, passStatuses } from "@/features/passes/pass";
import {
  type EntryPackSize,
  type PassTier,
  passTiers,
} from "@/features/passes/pass-offer";
import type { passPurchaseQuoteCodec } from "@/features/passes/pass-purchase-quote";
import type { PlainDate } from "@/shared/utils/temporal";
import { instant } from "../instant";
import { customerAccounts } from "./customer-accounts";
import { orders } from "./orders";
import { quotedSqlList } from "./sql-list";

export const passPurchases = pgTable(
  "pass_purchases",
  {
    id: text("id")
      .primaryKey()
      .$type<OrderId>()
      .references(() => orders.id),
    buyerAccountId: text("buyer_account_id")
      .notNull()
      .$type<CustomerAccountId>()
      .references(() => customerAccounts.id),
    holderAccountId: text("holder_account_id")
      .notNull()
      .$type<CustomerAccountId>()
      .references(() => customerAccounts.id),
    renewsPassId: text("renews_pass_id").$type<OrderId>(),
    product: text("product").notNull().$type<"entry-pack" | "unlimited">(),
    tier: text("tier").notNull().$type<PassTier>(),
    entryCount: integer("entry_count").$type<EntryPackSize>(),
    unlimitedCoffee: boolean("unlimited_coffee"),
    unlimitedMonitorOption: text(
      "unlimited_monitor_option"
    ).$type<WorkspaceProductMonitorOption>(),
    holdsExpireAt: instant("holds_expire_at"),
    status: text("status").notNull().$type<PassStatus>(),
    validFrom: date("valid_from", { mode: "string" })
      .notNull()
      .$type<PlainDate>(),
    validUntil: date("valid_until", { mode: "string" })
      .notNull()
      .$type<PlainDate>(),
    /** Exclusive cutoff after an Unlimited pass is withdrawn. */
    accessEndsOn: date("access_ends_on", { mode: "string" }).$type<PlainDate>(),
    /** First verified delivery of the paid Unlimited confirmation to the buyer. */
    buyerConfirmationDeliveredAt: instant("buyer_confirmation_delivered_at"),
    quote: jsonb("quote")
      .notNull()
      .$type<typeof passPurchaseQuoteCodec.Encoded>(),
    locale: text("locale").notNull().$type<Locale>(),
    createdAt: instant("created_at").notNull(),
    giftIssuedAt: instant("gift_issued_at"),
    giftClaimedAt: instant("gift_claimed_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.renewsPassId],
      foreignColumns: [t.id],
      name: "pass_purchases_renews_pass_id_fk",
    }),
    check(
      "pass_purchases_renewal_check",
      sql`${t.renewsPassId} is null or (${t.product} = 'unlimited'
        and ${t.renewsPassId} <> ${t.id})`
    ),
    check(
      "pass_purchases_product_check",
      sql`(${t.product} = 'entry-pack' and ${t.entryCount} is not null
          and ${t.entryCount} in (5, 10)
          and ${t.unlimitedCoffee} is null and ${t.unlimitedMonitorOption} is null
          and ${t.holdsExpireAt} is null and ${t.accessEndsOn} is null)
        or (${t.product} = 'unlimited' and ${t.entryCount} is null
          and (${t.tier} = 'open-space') = (${t.unlimitedCoffee} is not null)
          and (${t.tier} = 'reserved-desk-workstation') = (${t.unlimitedMonitorOption} is not null))`
    ),
    check(
      "pass_purchases_tier_check",
      sql`${t.tier} in (${quotedSqlList(passTiers)})`
    ),
    check(
      "pass_purchases_monitor_option_check",
      sql`${t.unlimitedMonitorOption} in (${quotedSqlList(workspaceProductMonitorOptions)})`
    ),
    check(
      "pass_purchases_status_check",
      sql`${t.status} in (${quotedSqlList(passStatuses)})`
    ),
    check(
      "pass_purchases_validity_check",
      sql`${t.validFrom} < ${t.validUntil}
        and (${t.accessEndsOn} is null or ${t.accessEndsOn} between ${t.validFrom} and ${t.validUntil})`
    ),
    check(
      "pass_purchases_gift_claim_check",
      sql`(${t.giftIssuedAt} is null and ${t.giftClaimedAt} is null) or ${t.holderAccountId} <> ${t.buyerAccountId}`
    ),
    index("pass_purchases_buyer_idx").on(t.buyerAccountId),
    index("pass_purchases_holder_idx").on(t.holderAccountId),
    index("pass_purchases_renews_pass_idx").on(t.renewsPassId),
  ]
);
