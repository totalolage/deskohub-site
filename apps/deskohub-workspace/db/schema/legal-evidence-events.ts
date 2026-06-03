import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { postgresUuidV7 } from "../uuid-v7";
import { workspaceReservations } from "./workspace-reservations";

export const legalEvidenceEvents = pgTable(
  "legal_evidence_events",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    workspaceReservationId: text("workspace_reservation_id").references(
      () => workspaceReservations.id,
      { onDelete: "set null" }
    ),
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
  ]
);

export type LegalEvidenceEvent = typeof legalEvidenceEvents.$inferSelect;
export type NewLegalEvidenceEvent = typeof legalEvidenceEvents.$inferInsert;
