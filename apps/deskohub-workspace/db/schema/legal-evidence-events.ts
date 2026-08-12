import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import type { LegalEvidenceEventId } from "@/features/checkout/legal-evidence";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { workspaceReservations } from "./workspace-reservations";

export const legalEvidenceEvents = pgTable(
  "legal_evidence_events",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<LegalEvidenceEventId>(),
    workspaceReservationId: text("workspace_reservation_id")
      .$type<WorkspaceReservationId>()
      .references(() => workspaceReservations.id, { onDelete: "set null" }),
    documentKey: text("document_key").notNull(),
    documentPath: text("document_path").notNull(),
    documentContent: text("document_content"),
    documentHash: text("document_hash").notNull(),
    hashAlgorithm: text("hash_algorithm").notNull().$type<"sha256">(),
    accepted: boolean("accepted").notNull(),
    acceptedAt: instant("accepted_at").notNull(),
    locale: text("locale").notNull(),
    source: text("source").notNull(),
    acknowledgements:
      jsonb("acknowledgements").$type<Record<string, boolean>>(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
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
