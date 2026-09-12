import type { DotyposCustomerId } from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import { check, pgTable, text } from "drizzle-orm/pg-core";
import { instant } from "../instant";

type CustomerMarketingManagementTokenPurpose = "link" | "session";

export const customerMarketingManagementTokens = pgTable(
  "customer_marketing_management_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    dotyposCustomerId: text("dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
    purpose: text("purpose")
      .notNull()
      .$type<CustomerMarketingManagementTokenPurpose>(),
    expiresAt: instant("expires_at").notNull(),
    revokedAt: instant("revoked_at"),
  },
  (t) => [
    check(
      "customer_marketing_management_tokens_token_hash_check",
      sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "customer_marketing_management_tokens_customer_check",
      sql`btrim(${t.dotyposCustomerId}) <> ''`
    ),
    check(
      "customer_marketing_management_tokens_purpose_check",
      sql`${t.purpose} in ('link', 'session')`
    ),
  ]
);
