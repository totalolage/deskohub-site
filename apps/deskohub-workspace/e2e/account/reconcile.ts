import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { Cause, Effect, Exit } from "effect";
import type { DatasourceConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import { toWorkspaceE2EError, workspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import { waitForCancelledDotyposReservations } from "../integrations/dotypos";
import { pollUntil } from "../polling";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import { removeSyntheticAuthUser } from "./auth-rows";
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
}: {
  readonly datasourceConfig: DatasourceConfig;
  readonly journal: WorkspaceE2EAccountJournal;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const failures: WorkspaceE2EError[] = [];

    const reservationExit = yield* Effect.exit(
      reconcileReservations(datasourceConfig, journal)
    );
    if (Exit.isFailure(reservationExit)) {
      failures.push(toWorkspaceE2EFailure(Cause.squash(reservationExit.cause)));
    }

    for (const customerId of journal.dotyposCustomerIds) {
      const exit = yield* Effect.exit(
        expireAndConvergeProfile(datasourceConfig, customerId)
      );
      if (Exit.isFailure(exit)) {
        failures.push(toWorkspaceE2EFailure(Cause.squash(exit.cause)));
      }
    }

    const authExit = yield* Effect.exit(
      Effect.forEach(journal.authUserIds, removeSyntheticAuthUser, {
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
  datasourceConfig: DatasourceConfig
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const journal = yield* Effect.tryPromise({
      catch: (cause) =>
        workspaceE2EError("read workspace account e2e lane journal", {
          cause,
          operation: "read workspace account e2e lane journal",
        }),
      try: () => readWorkspaceE2EAccountJournal(),
    });
    if (!journal) return;
    yield* reconcileWorkspaceE2EAccountJournal({
      datasourceConfig,
      journal,
    });
  });

const reconcileReservations = (
  datasourceConfig: DatasourceConfig,
  journal: WorkspaceE2EAccountJournal
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    if (journal.dotyposReservationIds.length === 0) return;
    const reservationIds = journal.dotyposReservationIds.map(
      (value) => value as DotyposReservationId
    );
    yield* Effect.forEach(
      reservationIds,
      (reservationId) =>
        cancelSyntheticReservation(datasourceConfig, reservationId),
      { concurrency: "unbounded", discard: true }
    );
    yield* waitForCancelledDotyposReservations(
      datasourceConfig,
      reservationIds,
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
