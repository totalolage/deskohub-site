import { Cause, Effect, Exit, Option } from "effect";
import type { DatasourceConfig } from "../config";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import type { WorkspaceE2ERunId } from "../run-identifiers";
import { makeWorkspaceE2EAccountRecipientForRunId } from "./config";
import {
  type WorkspaceE2EAccountJournal,
  type WorkspaceE2EAccountJournalOwnerId,
  workspaceE2EAccountLaneId,
} from "./journal";
import { WorkspaceE2EAccountResourceService } from "./resources.service";

type WorkspaceE2EAccountCleanupIds = Pick<
  WorkspaceE2EAccountJournal,
  "authUserIds" | "dotyposCustomerIds" | "dotyposReservationIds"
>;

export type WorkspaceE2EAccountLaneReconciliation =
  WorkspaceE2EAccountCleanupIds & {
    readonly journal: WorkspaceE2EAccountJournal;
    /** Where completion persists the journal; the checkout suite's when absent. */
    readonly journalDirectory?: string;
  };

/*
 * The prepared IDs are the currently existing, owner-checked subset. The
 * original journal remains immutable and is what completion persists.
 */
type WorkspaceE2EAccountLaneCandidates = WorkspaceE2EAccountCleanupIds;

const toWorkspaceE2EFailure = (cause: unknown): WorkspaceE2EError =>
  toWorkspaceE2EError("workspace account e2e finalizer step", cause);

/**
 * Interruption-safe finalizer for one account case journal. Cancels and
 * converges every journaled synthetic reservation, expires (never deletes)
 * every journaled synthetic Dotypos profile, then deletes the journaled
 * referral and reservation rows, and deletes exactly the journaled
 * synthetic accounts as account deletion does: each customer
 * account keeps its tombstone, and the Better Auth user rows' cascades remove
 * sessions, accounts, and the customer-account link. Runs for completed journals again
 * because every step is idempotent for the exact owned IDs.
 */
const reconcileWorkspaceE2EAccountJournal = ({
  journal,
  journalDirectory,
  candidates = journal,
}: {
  readonly journal: WorkspaceE2EAccountJournal;
  readonly journalDirectory?: string;
  readonly candidates?: WorkspaceE2EAccountLaneCandidates;
}): Effect.Effect<
  void,
  WorkspaceE2EError,
  WorkspaceE2EAccountResourceService
> =>
  Effect.gen(function* () {
    const resources = yield* WorkspaceE2EAccountResourceService;
    const failures: WorkspaceE2EError[] = [];

    const reservationExit = yield* Effect.exit(
      resources.cancelReservations(candidates.dotyposReservationIds)
    );
    if (Exit.isFailure(reservationExit)) {
      failures.push(toWorkspaceE2EFailure(Cause.squash(reservationExit.cause)));
    }

    for (const customerId of candidates.dotyposCustomerIds) {
      const exit = yield* Effect.exit(resources.expireProfile(customerId));
      if (Exit.isFailure(exit)) {
        failures.push(toWorkspaceE2EFailure(Cause.squash(exit.cause)));
      }
    }

    // The rows are the ownership evidence for resources no recipient email
    // matches, so they go only once every resource they prove is settled; a
    // failed or interrupted provider step leaves them for the next pass.
    if (failures.length === 0) {
      const referralRowsExit = yield* Effect.exit(
        resources.removeRows({
          syntheticDotyposCustomerIds: journal.dotyposCustomerIds,
          syntheticDotyposReservationIds: journal.dotyposReservationIds,
        })
      );
      if (Exit.isFailure(referralRowsExit)) {
        failures.push(
          toWorkspaceE2EFailure(Cause.squash(referralRowsExit.cause))
        );
      }
    }

    const authExit = yield* Effect.exit(
      Effect.forEach(candidates.authUserIds, resources.removeAuthUser, {
        discard: true,
      })
    );
    if (Exit.isFailure(authExit)) {
      failures.push(toWorkspaceE2EFailure(Cause.squash(authExit.cause)));
    }

    if (failures.length === 1 && failures[0]) {
      return yield* failures[0];
    }
    if (failures.length > 1) {
      return yield* workspaceE2EError(
        "Workspace account e2e finalizer failed",
        {
          causes: failures,
          operation: "reconcile workspace account e2e journal",
        }
      );
    }

    yield* resources.writeJournal(
      { ...journal, completed: true },
      journalDirectory
    );
  });

/**
 * Reconciles every prepared account identity journal during suite cleanup.
 * A missing journal means its owner never admitted a case; an existing
 * journal is always reconciled because every step is idempotent for the
 * exact owned IDs, even when the owner already finished. Every journal is
 * attempted before the first failure is reported.
 */
export const reconcileWorkspaceE2EAccountJournals = (
  prepared: readonly WorkspaceE2EAccountLaneReconciliation[]
): Effect.Effect<void, WorkspaceE2EError, WorkspaceE2EAccountResourceService> =>
  Effect.gen(function* () {
    const failures: WorkspaceE2EError[] = [];
    for (const candidates of prepared) {
      const exit = yield* Effect.exit(
        reconcileWorkspaceE2EAccountJournal({
          candidates,
          journal: candidates.journal,
          journalDirectory: candidates.journalDirectory,
        })
      );
      if (Exit.isFailure(exit)) {
        failures.push(toWorkspaceE2EFailure(Cause.squash(exit.cause)));
      }
    }
    if (failures.length === 1 && failures[0]) return yield* failures[0];
    if (failures.length > 1) {
      return yield* workspaceE2EError(
        "Workspace account e2e journal reconciliation failed",
        {
          causes: failures,
          operation: "reconcile workspace account e2e journals",
        }
      );
    }
  });

const accountLaneRecipientLabels = [
  "main",
  "accepted-b",
  "referral-owner",
] as const;

/**
 * What an owner proves about journaled IDs of one kind beyond a recipient
 * email match.
 */
type WorkspaceE2EAccountOwnershipEvidence = {
  /** Created by the owner, as another record proves (such as authorship). */
  readonly ownedIds: ReadonlySet<string>;
  /** Already cancelled or expired, so cleanup leaves them alone. */
  readonly settledIds: ReadonlySet<string>;
};

export type WorkspaceE2EAccountJournalEvidence = {
  readonly dotyposCustomerIds: WorkspaceE2EAccountOwnershipEvidence;
  readonly dotyposReservationIds: WorkspaceE2EAccountOwnershipEvidence;
};

/**
 * One account identity journal owner and the exact run-scoped recipient
 * labels whose synthetic identities it may own.
 */
export type WorkspaceE2EAccountJournalOwner = {
  /** The suite's journal directory; the checkout suite's when absent. */
  readonly journalDirectory?: string;
  readonly ownerId: WorkspaceE2EAccountJournalOwnerId;
  readonly recipientLabels: readonly string[];
  /**
   * Proves ownership of journaled Dotypos IDs whose owner email is not one of
   * the recipients, such as a hold the owner's account booked for another
   * contact. IDs it neither owns nor settles still fail validation.
   */
  readonly proveOwnership?: (
    datasourceConfig: DatasourceConfig,
    journal: WorkspaceE2EAccountJournal
  ) => Effect.Effect<
    WorkspaceE2EAccountJournalEvidence,
    WorkspaceE2EError,
    E2EDatabase
  >;
};

export const workspaceE2EAccountLaneJournalOwner: WorkspaceE2EAccountJournalOwner =
  {
    ownerId: workspaceE2EAccountLaneId,
    recipientLabels: accountLaneRecipientLabels,
  };

export const validateWorkspaceE2EAccountLaneJournalOwnership = ({
  journal,
  recipientEmails,
  authUserOwners,
  customerOwners,
  reservationOwners,
  evidence,
}: {
  readonly journal: WorkspaceE2EAccountJournal;
  readonly recipientEmails: ReadonlySet<string>;
  readonly authUserOwners: ReadonlyMap<string, string | null | undefined>;
  readonly customerOwners: ReadonlyMap<string, string | null | undefined>;
  readonly reservationOwners: ReadonlyMap<string, string | null | undefined>;
  readonly evidence?: WorkspaceE2EAccountJournalEvidence;
}): WorkspaceE2EAccountLaneReconciliation => {
  const validateCandidates = (
    ids: readonly string[],
    owners: ReadonlyMap<string, string | null | undefined>,
    proof?: WorkspaceE2EAccountOwnershipEvidence
  ) =>
    ids.flatMap((id) => {
      if (!owners.has(id)) {
        throw new Error("Workspace account e2e ownership preflight incomplete");
      }
      const email = owners.get(id);
      if (email === undefined) return [];
      if (email !== null && recipientEmails.has(email)) return [id];
      if (proof?.ownedIds.has(id)) return [id];
      if (proof?.settledIds.has(id)) return [];
      if (email === null) {
        throw new Error(
          "Workspace account e2e candidate owner email is unavailable"
        );
      }
      if (!recipientEmails.has(email)) {
        throw new Error("Workspace account e2e journal ownership mismatch");
      }
      return [id];
    });

  return {
    journal,
    authUserIds: validateCandidates(journal.authUserIds, authUserOwners),
    dotyposCustomerIds: validateCandidates(
      journal.dotyposCustomerIds,
      customerOwners,
      evidence?.dotyposCustomerIds
    ),
    dotyposReservationIds: validateCandidates(
      journal.dotyposReservationIds,
      reservationOwners,
      evidence?.dotyposReservationIds
    ),
  };
};

export const prepareWorkspaceE2EAccountLaneReconciliation = (
  datasourceConfig: DatasourceConfig,
  runId: WorkspaceE2ERunId,
  owner: WorkspaceE2EAccountJournalOwner = workspaceE2EAccountLaneJournalOwner
): Effect.Effect<
  WorkspaceE2EAccountLaneReconciliation | undefined,
  WorkspaceE2EError,
  E2EDatabase | WorkspaceE2EAccountResourceService
> =>
  Effect.gen(function* () {
    const resources = yield* WorkspaceE2EAccountResourceService;
    const journal = yield* resources.readJournal(
      owner.ownerId,
      owner.journalDirectory
    );
    if (!journal) return undefined;

    const recipientEmails = new Set(
      owner.recipientLabels.map((label) =>
        makeWorkspaceE2EAccountRecipientForRunId(runId, label)
      )
    );

    const authUserOwners = yield* Effect.forEach(journal.authUserIds, (id) =>
      resources
        .readAuthUserEmail(id)
        .pipe(Effect.map((email) => [id, email] as const))
    );
    const customerOwners = yield* Effect.forEach(
      journal.dotyposCustomerIds,
      (id) =>
        resources.readCustomerProfile(id).pipe(
          Effect.map(
            (customer) =>
              [
                id,
                Option.match(customer, {
                  onNone: () => undefined,
                  onSome: ({ email }) => email ?? null,
                }),
              ] as const
          )
        )
    );
    const reservationOwners = yield* Effect.forEach(
      journal.dotyposReservationIds,
      (id) =>
        resources
          .readReservationOwner(id)
          .pipe(
            Effect.map((email) => [id, Option.getOrUndefined(email)] as const)
          )
    );
    const evidence = owner.proveOwnership
      ? yield* owner.proveOwnership(datasourceConfig, journal)
      : undefined;
    try {
      const validated = validateWorkspaceE2EAccountLaneJournalOwnership({
        journal,
        recipientEmails,
        authUserOwners: new Map(authUserOwners),
        customerOwners: new Map(customerOwners),
        reservationOwners: new Map(reservationOwners),
        ...(evidence ? { evidence } : {}),
      });
      return owner.journalDirectory === undefined
        ? validated
        : { ...validated, journalDirectory: owner.journalDirectory };
    } catch (cause) {
      return yield* workspaceE2EError(
        "Workspace account e2e journal ownership validation failed",
        { cause, operation: "validate workspace account e2e journal ownership" }
      );
    }
  });

/**
 * Prepares every account identity journal that exists for the given owners,
 * each validated against its own recipient labels.
 */
export const prepareWorkspaceE2EAccountJournalReconciliations = (
  datasourceConfig: DatasourceConfig,
  runId: WorkspaceE2ERunId,
  owners: readonly WorkspaceE2EAccountJournalOwner[]
): Effect.Effect<
  readonly WorkspaceE2EAccountLaneReconciliation[],
  WorkspaceE2EError,
  E2EDatabase | WorkspaceE2EAccountResourceService
> =>
  Effect.forEach(owners, (owner) =>
    prepareWorkspaceE2EAccountLaneReconciliation(datasourceConfig, runId, owner)
  ).pipe(
    Effect.map((prepared) =>
      prepared.filter(
        (entry): entry is WorkspaceE2EAccountLaneReconciliation =>
          entry !== undefined
      )
    )
  );
