import type { DotyposCustomerId } from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/contracts";
import { instant } from "../instant";

export const customerAccountLinks = pgTable("customer_account_links", {
  customerAccountId: text("customer_account_id")
    .primaryKey()
    .$type<CustomerAccountId>(),
  dotyposCustomerId: text("dotypos_customer_id")
    .notNull()
    .unique()
    .$type<DotyposCustomerId>(),
  createdAt: instant("created_at").notNull().default(sql`now()`),
  updatedAt: instant("updated_at").notNull().default(sql`now()`),
});

export type CustomerAccountLink = typeof customerAccountLinks.$inferSelect;
export type NewCustomerAccountLink = typeof customerAccountLinks.$inferInsert;
