import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { CheckoutReturnStateJson } from "@/features/checkout/types/checkout-return-state";
import { paymentOrders } from "./payment-orders";

export const checkoutReturnStateTokens = pgTable(
  "checkout_return_state_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    paymentOrderId: text("payment_order_id")
      .notNull()
      .references(() => paymentOrders.id, { onDelete: "cascade" }),
    state: jsonb("state").notNull().$type<CheckoutReturnStateJson>(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    consumedAt: timestamp("consumed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("checkout_return_state_tokens_payment_order_idx").on(
      t.paymentOrderId
    ),
    index("checkout_return_state_tokens_active_idx")
      .on(t.expiresAt)
      .where(sql`${t.consumedAt} is null`),
  ]
);

export type CheckoutReturnStateToken =
  typeof checkoutReturnStateTokens.$inferSelect;
export type NewCheckoutReturnStateToken =
  typeof checkoutReturnStateTokens.$inferInsert;
