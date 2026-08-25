import type { DotyposCustomerId } from "@deskohub/dotypos";
import { pgTable, text } from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";

export const customerAccountLinks = pgTable("customer_account_links", {
  customerAccountId: text("customer_account_id")
    .primaryKey()
    .$type<CustomerAccountId>(),
  dotyposCustomerId: text("dotypos_customer_id")
    .notNull()
    .unique()
    .$type<DotyposCustomerId>(),
});

export type CustomerAccountLink = typeof customerAccountLinks.$inferSelect;
