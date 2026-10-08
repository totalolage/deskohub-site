import {
  type DotyposCustomerId,
  type DotyposReservationId,
  DotyposService,
  ExternalAPIError,
} from "@deskohub/dotypos";
import { Cause, Effect, Exit } from "effect";
import type { DatasourceConfig } from "../config";
import {
  toWorkspaceE2EError,
  WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import {
  getDotyposLayer,
  waitForCancelledDotyposReservations,
} from "../integrations/dotypos";
import { pollUntil } from "../polling";
import type { WorkspaceE2ERunId } from "../run-identifiers";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import { findAuthUserEmailById, removeSyntheticAuthUser } from "./auth-rows";
import { makeWorkspaceE2EAccountRecipientForRunId } from "./config";
import {
  cancelSyntheticReservation,
  expireSyntheticCustomerProfile,
  readSyntheticCustomerProfile,
} from "./fixtures";
import {
  readWorkspaceE2EAccountJournal,
  type WorkspaceE2EAccountJournal,
  writeWorkspaceE2EAccountJournal,
} from "./journal";

type WorkspaceE2EAccountCleanupIds = Pick<
  WorkspaceE2EAccountJournal,
  "authUserIds" | "dotyposCustomerIds" | "dotyposReservationIds"
>;

export type WorkspaceE2EAccountLaneReconciliation =
  WorkspaceE2EAccountCleanupIds & {
    readonly journal: WorkspaceE2EAccountJournal;
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
 * every journaled synthetic Dotypos profile, and deletes exactly the
 * journaled synthetic Better Auth user rows, whose cascades remove sessions,
 * accounts, and the customer-account link. Runs for completed journals again
 * because every step is idempotent for the exact owned IDs.
 */
export const reconcileWorkspaceE2EAccountJournal = ({
  datasourceConfig,
  journal,
  candidates = journal,
}: {
  readonly datasourceConfig: DatasourceConfig;
  readonly journal: WorkspaceE2EAccountJournal;
  readonly candidates?: WorkspaceE2EAccountLaneCandidates;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const failures: WorkspaceE2EError[] = [];

    const reservationExit = yield* Effect.exit(
      reconcileReservations(datasourceConfig, candidates.dotyposReservationIds)
    );
    if (Exit.isFailure(reservationExit)) {
      failures.push(toWorkspaceE2EFailure(Cause.squash(reservationExit.cause)));
    }

    for (const customerId of candidates.dotyposCustomerIds) {
      const exit = yield* Effect.exit(
        expireAndConvergeProfile(datasourceConfig, customerId)
      );
      if (Exit.isFailure(exit)) {
        failures.push(toWorkspaceE2EFailure(Cause.squash(exit.cause)));
      }
    }

    const authExit = yield* Effect.exit(
      Effect.forEach(candidates.authUserIds, removeSyntheticAuthUser, {
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

    yield* Effect.tryPromise({
      catch: (cause) =>
        workspaceE2EError("persist workspace account e2e journal", {
          cause,
          operation: "persist workspace account e2e journal",
        }),
      try: () =>
        writeWorkspaceE2EAccountJournal({ ...journal, completed: true }),
    });
  });

/**
 * Reconciles the account lane journal during suite cleanup. A missing
 * journal means the lane never admitted a case; an existing journal is
 * always reconciled because every step is idempotent for the exact owned
 * IDs, even when the lane already finished.
 */
export const reconcileWorkspaceE2EAccountLane = (
  datasourceConfig: DatasourceConfig,
  prepared: WorkspaceE2EAccountLaneReconciliation | undefined
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    if (!prepared) return;
    yield* reconcileWorkspaceE2EAccountJournal({
      datasourceConfig,
      candidates: prepared,
      journal: prepared.journal,
    });
  });

const accountLaneRecipientLabels = ["main", "accepted-b"] as const;

type AccountLanePreparationDependencies = {
  readonly readJournal: typeof readWorkspaceE2EAccountJournal;
  readonly findAuthUserEmailById: typeof findAuthUserEmailById;
  readonly readSyntheticCustomerProfile: typeof readSyntheticCustomerProfile;
  readonly readReservationOwner: typeof readAccountReservationOwner;
};

const readAccountReservationOwner = Effect.fn(
  "readWorkspaceE2EAccountReservationOwner"
)(function* (datasourceConfig: DatasourceConfig, id: string) {
  const { customer } = yield* Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    return yield* dotypos.getReservation(id as DotyposReservationId);
  }).pipe(
    Effect.provide(getDotyposLayer(datasourceConfig)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("read synthetic account reservation owner", cause)
    )
  );
  return customer.email ?? null;
});

export const validateWorkspaceE2EAccountLaneJournalOwnership = ({
  journal,
  recipientEmails,
  authUserOwners,
  customerOwners,
  reservationOwners,
}: {
  readonly journal: WorkspaceE2EAccountJournal;
  readonly recipientEmails: ReadonlySet<string>;
  readonly authUserOwners: ReadonlyMap<string, string | null | undefined>;
  readonly customerOwners: ReadonlyMap<string, string | null | undefined>;
  readonly reservationOwners: ReadonlyMap<string, string | null | undefined>;
}): WorkspaceE2EAccountLaneReconciliation => {
  const validateCandidates = (
    ids: readonly string[],
    owners: ReadonlyMap<string, string | null | undefined>
  ) =>
    ids.flatMap((id) => {
      if (!owners.has(id)) {
        throw new Error("Workspace account e2e ownership preflight incomplete");
      }
      const email = owners.get(id);
      if (email === undefined) return [];
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
      customerOwners
    ),
    dotyposReservationIds: validateCandidates(
      journal.dotyposReservationIds,
      reservationOwners
    ),
  };
};

export const prepareWorkspaceE2EAccountLaneReconciliation = (
  datasourceConfig: DatasourceConfig,
  runId: WorkspaceE2ERunId,
  dependencies: AccountLanePreparationDependencies = {
    readJournal: readWorkspaceE2EAccountJournal,
    findAuthUserEmailById,
    readSyntheticCustomerProfile,
    readReservationOwner: readAccountReservationOwner,
  }
): Effect.Effect<
  WorkspaceE2EAccountLaneReconciliation | undefined,
  WorkspaceE2EError,
  E2EDatabase
> =>
  Effect.gen(function* () {
    const journal = yield* Effect.tryPromise({
      catch: (cause) =>
        workspaceE2EError("read workspace account e2e lane journal", {
          cause,
          operation: "read workspace account e2e lane journal",
        }),
      try: () => dependencies.readJournal(),
    });
    if (!journal) return undefined;

    const recipientEmails = new Set(
      accountLaneRecipientLabels.map((label) =>
        makeWorkspaceE2EAccountRecipientForRunId(runId, label)
      )
    );

    const authUserOwners = yield* Effect.forEach(journal.authUserIds, (id) =>
      dependencies
        .findAuthUserEmailById(id)
        .pipe(Effect.map((email) => [id, email] as const))
    );
    const customerOwners = yield* Effect.forEach(
      journal.dotyposCustomerIds,
      (id) =>
        dependencies
          .readSyntheticCustomerProfile(
            datasourceConfig,
            id as DotyposCustomerId
          )
          .pipe(
            Effect.map((customer) => [id, customer.email ?? null] as const),
            Effect.catchIf(isNotFound("getCustomer"), () =>
              Effect.succeed([id, undefined] as const)
            )
          )
    );
    const reservationOwners = yield* Effect.forEach(
      journal.dotyposReservationIds,
      (id) =>
        dependencies.readReservationOwner(datasourceConfig, id).pipe(
          Effect.map((email) => [id, email] as const),
          Effect.catchIf(isNotFound("getReservation"), () =>
            Effect.succeed([id, undefined] as const)
          )
        )
    );
    try {
      return validateWorkspaceE2EAccountLaneJournalOwnership({
        journal,
        recipientEmails,
        authUserOwners: new Map(authUserOwners),
        customerOwners: new Map(customerOwners),
        reservationOwners: new Map(reservationOwners),
      });
    } catch (cause) {
      return yield* workspaceE2EError(
        "Workspace account e2e journal ownership validation failed",
        { cause, operation: "validate workspace account e2e journal ownership" }
      );
    }
  });

const isNotFound =
  (operation: string) =>
  (cause: unknown): boolean => {
    if (cause instanceof WorkspaceE2EError) {
      return isNotFound(operation)(cause.cause);
    }
    return (
      cause instanceof ExternalAPIError &&
      cause.operation === operation &&
      cause.statusCode === 404
    );
  };

const reconcileReservations = (
  datasourceConfig: DatasourceConfig,
  reservationIds: readonly string[]
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    if (reservationIds.length === 0) return;
    const dotyposReservationIds = reservationIds.map(
      (value) => value as DotyposReservationId
    );
    yield* Effect.forEach(
      dotyposReservationIds,
      (reservationId) =>
        cancelSyntheticReservation(datasourceConfig, reservationId),
      { concurrency: "unbounded", discard: true }
    );
    yield* waitForCancelledDotyposReservations(
      datasourceConfig,
      dotyposReservationIds,
      {
        endDate: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000),
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      }
    ).pipe(
      Effect.mapError((cause) =>
        workspaceE2EError("converge synthetic account reservations", {
          cause,
          operation: "converge synthetic account reservations",
        })
      )
    );
  });

const expireAndConvergeProfile = (
  datasourceConfig: DatasourceConfig,
  customerId: string
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* expireSyntheticCustomerProfile(
      datasourceConfig,
      customerId as DotyposCustomerId
    );
    yield* pollUntil(
      readSyntheticCustomerProfile(
        datasourceConfig,
        customerId as DotyposCustomerId
      ).pipe(
        Effect.map((customer) =>
          customer.expireDate != null &&
          new Date(customer.expireDate).getTime() <= Date.now()
            ? customer
            : undefined
        )
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: "expired synthetic Dotypos profile convergence",
        timeoutMs: datasourceConfig.timeouts.datasource,
      }
    );
  }).pipe(
    Effect.mapError((cause) =>
      workspaceE2EError("expire synthetic Dotypos profile", {
        cause,
        operation: "expire synthetic Dotypos profile",
      })
    )
  );
