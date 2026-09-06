import type { Effect } from "effect";
import type { HttpClient } from "effect/unstable/http";
import type { WorkspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import type { E2ETelemetryService } from "../services/telemetry";
import type { WorkspaceE2EStepRunner } from "../types";
import type { WorkspaceE2EAccountCaseId } from "./catalog";
import type { WorkspaceE2EAccountJournal } from "./journal";

export type WorkspaceE2EAccountRequirement =
  | E2EDatabase
  | E2ETelemetryService
  | HttpClient.HttpClient;

/**
 * In-memory handoff from the deletion marker case to the reactivation case.
 * The worker-scoped lane fixture owns the one instance because Playwright
 * rebuilds the case factory for every test; it never carries links or tokens
 * and stays out of the cleanup journal.
 */
export type WorkspaceE2EAccountDeletionHandoff = {
  deletedUserId?: string;
  retainedCustomerId?: string;
};

export type WorkspaceE2EAccountJournalRef = {
  readonly journal: WorkspaceE2EAccountJournal;
  readonly record: (
    update: Pick<
      WorkspaceE2EAccountJournal,
      "authUserIds" | "dotyposCustomerIds" | "dotyposReservationIds"
    >
  ) => Promise<void>;
};

export type WorkspaceE2EAccountCase = {
  readonly execute: (context: {
    readonly journalRef: WorkspaceE2EAccountJournalRef;
    readonly runStep: WorkspaceE2EStepRunner;
    readonly session: string;
  }) => Effect.Effect<void, WorkspaceE2EError, WorkspaceE2EAccountRequirement>;
  readonly id: WorkspaceE2EAccountCaseId;
  readonly timeoutMs: number;
};
