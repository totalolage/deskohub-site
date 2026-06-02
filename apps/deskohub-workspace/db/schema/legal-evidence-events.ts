import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { workspaceReservations } from "./workspace-reservations";

export const legalEvidenceEvents = pgTable(
  "legal_evidence_events",
  {
    id: text("id").primaryKey(),
    workspaceReservationId: text("workspace_reservation_id").references(
      () => workspaceReservations.id,
      { onDelete: "set null" }
    ),
    idempotencyKey: text("idempotency_key").notNull(),
    documentKey: text("document_key").notNull(),
    documentPath: text("document_path").notNull(),
    documentHash: text("document_hash").notNull(),
    hashAlgorithm: text("hash_algorithm").notNull().$type<"sha256">(),
    accepted: boolean("accepted").notNull(),
    acceptedAt: timestamp("accepted_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    locale: text("locale").notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "legal_evidence_events_hash_algorithm_check",
      sql`${t.hashAlgorithm} = 'sha256'`
    ),
    index("legal_evidence_events_workspace_reservation_idx").on(
      t.workspaceReservationId
    ),
    index("legal_evidence_events_idempotency_document_idx").on(
      t.idempotencyKey,
      t.documentHash
    ),
  ]
);

export type LegalEvidenceEvent = typeof legalEvidenceEvents.$inferSelect;
export type NewLegalEvidenceEvent = typeof legalEvidenceEvents.$inferInsert;
