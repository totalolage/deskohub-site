import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { paymentAttempts } from "./payment-attempts";
import { quotedSqlList } from "./sql-list";

export const paymentEvidenceConflictCodes = [
  "provider_order_identity",
  "provider_amount",
  "provider_currency",
  "provider_security_token",
  "provider_operation_evidence",
  "provider_terminal_state",
] as const;

export type PaymentEvidenceConflictCode =
  (typeof paymentEvidenceConflictCodes)[number];

export const paymentEvidenceConflicts = pgTable(
  "payment_evidence_conflicts",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    paymentAttemptId: text("payment_attempt_id")
      .notNull()
      .references(() => paymentAttempts.id, { onDelete: "cascade" }),
    conflictCode: text("conflict_code")
      .notNull()
      .$type<PaymentEvidenceConflictCode>(),
    firstObservedAt: instant("first_observed_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "payment_evidence_conflicts_code_check",
      sql`${t.conflictCode} in (${quotedSqlList(paymentEvidenceConflictCodes)})`
    ),
    uniqueIndex("payment_evidence_conflicts_attempt_code_unique_idx").on(
      t.paymentAttemptId,
      t.conflictCode
    ),
    index("payment_evidence_conflicts_attempt_idx").on(t.paymentAttemptId),
  ]
);

export type PaymentEvidenceConflictRow =
  typeof paymentEvidenceConflicts.$inferSelect;
