import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const legalEvidenceAuditEvents = pgTable(
  "legal_evidence_audit_events",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id"),
    idempotencyKey: text("idempotency_key"),
    documentHash: text("document_hash"),
    accepted: boolean("accepted"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("legal_evidence_audit_idempotency_document_idx").on(
      t.idempotencyKey,
      t.documentHash
    ),
    index("legal_evidence_audit_order_idx").on(t.orderId),
  ]
);

export type LegalEvidenceAuditEvent =
  typeof legalEvidenceAuditEvents.$inferSelect;
export type NewLegalEvidenceAuditEvent =
  typeof legalEvidenceAuditEvents.$inferInsert;
