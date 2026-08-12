import { sql } from "drizzle-orm";
import { check, index, pgTable, text } from "drizzle-orm/pg-core";
import { instant } from "../instant";

export const mobileSessionHandoffCodes = pgTable(
  "mobile_session_handoff_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    expiresAt: instant("expires_at").notNull(),
  },
  (t) => [
    index("mobile_session_handoff_codes_expires_at_idx").on(t.expiresAt),
    check(
      "mobile_session_handoff_codes_hash_check",
      sql`${t.codeHash} ~ '^[A-Za-z0-9_-]{43}$'`
    ),
    check(
      "mobile_session_handoff_codes_expiry_check",
      sql`${t.expiresAt} > ${t.createdAt}`
    ),
  ]
);

export type MobileSessionHandoffCode =
  typeof mobileSessionHandoffCodes.$inferSelect;
export type NewMobileSessionHandoffCode =
  typeof mobileSessionHandoffCodes.$inferInsert;
