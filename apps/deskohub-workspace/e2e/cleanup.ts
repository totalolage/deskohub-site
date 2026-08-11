import type { DotyposReservationId } from "@deskohub/dotypos";
import { Cause, Effect, Exit } from "effect";
import { getWorkspaceE2EDateInterval } from "./capacity";
import type { DatasourceConfig } from "./config";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "./errors";
import {
  readCheckoutRow,
  readCleanupCheckoutRows,
} from "./integrations/database";
import type { E2EDatabase } from "./integrations/database.service";
import {
  cancelDotyposReservation,
  waitForCancelledDotyposReservations,
} from "./integrations/dotypos";
import { log, redact } from "./runtime";
import type { CheckoutData, CheckoutFlowState, CheckoutRow } from "./types";

export const cleanupCheckoutFlowStates = (
  {
    datasourceConfig,
    flowStates,
    workflowError,
  }: {
    datasourceConfig: DatasourceConfig | undefined;
    flowStates: readonly CheckoutFlowState[];
    workflowError: unknown;
  },
  dependencies: CleanupDependencies = liveCleanupDependencies
): Effect.Effect<WorkspaceE2EError | undefined, never, E2EDatabase> =>
  Effect.gen(function* () {
    const cleanupErrors: WorkspaceE2EError[] = [];
    const checkoutRows: CheckoutRow[] = flowStates.flatMap((state) =>
      state.checkoutRow ? [state.checkoutRow] : []
    );

    if (datasourceConfig) {
      const lookupResults = yield* Effect.all(
        {
          fallbackRows: Effect.all(
            getFallbackCleanupQueries(flowStates).map(({ data, startedAt }) =>
              Effect.exit(dependencies.readCleanupCheckoutRows(startedAt, data))
            ),
            { concurrency: "unbounded" }
          ),
          rowsByOrder: Effect.all(
            flowStates.flatMap((state) =>
              !state.checkoutRow?.dotypos_reservation_id && state.orderId
                ? [
                    Effect.exit(
                      dependencies.readCheckoutRow(state.orderId)
                    ).pipe(Effect.map((exit) => ({ exit, state }))),
                  ]
                : []
            ),
            { concurrency: "unbounded" }
          ),
        },
        { concurrency: "unbounded" }
      );

      for (const { exit: rowExit, state } of lookupResults.rowsByOrder) {
        if (Exit.isSuccess(rowExit)) {
          state.checkoutRow = rowExit.value;
          if (rowExit.value) checkoutRows.push(rowExit.value);
        } else {
          const cause = Cause.squash(rowExit.cause);
          cleanupErrors.push(
            toWorkspaceE2EError("read checkout cleanup row", cause)
          );
          if (workflowError)
            log(`Dotypos cleanup row lookup failed: ${redact(String(cause))}`);
        }
      }

      for (const rowExit of lookupResults.fallbackRows) {
        if (Exit.isSuccess(rowExit)) {
          checkoutRows.push(...rowExit.value);
        } else {
          const cause = Cause.squash(rowExit.cause);
          cleanupErrors.push(
            toWorkspaceE2EError("read checkout cleanup rows", cause)
          );
          if (workflowError)
            log(
              `Dotypos fallback cleanup row lookup failed: ${redact(String(cause))}`
            );
        }
      }
    }

    if (datasourceConfig) {
      const dotyposReservationIds = [
        ...new Set(
          checkoutRows.flatMap(({ dotypos_reservation_id }) =>
            dotypos_reservation_id ? [dotypos_reservation_id] : []
          )
        ),
      ];
      const completedReservationIds = new Set(
        flowStates.flatMap((state) => {
          const reservationId = state.checkoutRow?.dotypos_reservation_id;
          return state.cleanupComplete && reservationId ? [reservationId] : [];
        })
      );
      const cleanupExits = yield* Effect.all(
        dotyposReservationIds
          .filter(
            (dotyposReservationId) =>
              !completedReservationIds.has(dotyposReservationId)
          )
          .map((dotyposReservationId) =>
            Effect.exit(
              dependencies.cancelDotyposReservation(
                datasourceConfig,
                dotyposReservationId
              )
            ).pipe(Effect.map((exit) => ({ dotyposReservationId, exit })))
          ),
        { concurrency: "unbounded" }
      );
      const convergingReservationIds = new Set(completedReservationIds);

      for (const { dotyposReservationId, exit: cleanupExit } of cleanupExits) {
        if (Exit.isSuccess(cleanupExit)) {
          convergingReservationIds.add(dotyposReservationId);
        } else {
          const cause = Cause.squash(cleanupExit.cause);
          cleanupErrors.push(
            toWorkspaceE2EError("cancel Dotypos checkout reservation", cause)
          );
          if (workflowError)
            log(`Dotypos cleanup failed: ${redact(String(cause))}`);
        }
      }

      if (
        convergingReservationIds.size > 0 &&
        dependencies.waitForCancelledDotyposReservations
      ) {
        const reservationDates = flowStates.map(({ data }) => data.date).sort();
        const fromDate = reservationDates[0];
        const toDate = reservationDates.at(-1);
        const convergenceExit = yield* Effect.exit(
          fromDate && toDate
            ? dependencies.waitForCancelledDotyposReservations(
                datasourceConfig,
                [...convergingReservationIds],
                getWorkspaceE2EDateInterval({ fromDate, toDate })
              )
            : Effect.fail(
                workspaceE2EError(
                  "Dotypos cleanup reservations have no owned dates",
                  { operation: "wait for Dotypos cleanup convergence" }
                )
              )
        );
        if (Exit.isFailure(convergenceExit)) {
          const cause = Cause.squash(convergenceExit.cause);
          cleanupErrors.push(
            toWorkspaceE2EError("wait for Dotypos cleanup convergence", cause)
          );
          if (workflowError)
            log(`Dotypos cleanup convergence failed: ${redact(String(cause))}`);
        }
      }
    }

    return toCleanupError(cleanupErrors);
  });

export const cleanupOwnedCheckoutFlowStates = (
  {
    datasourceConfig,
    flowStates,
    workflowError,
  }: {
    readonly datasourceConfig: DatasourceConfig;
    readonly flowStates: readonly CheckoutFlowState[];
    readonly workflowError: unknown;
  },
  dependencies: OwnedCleanupDependencies = liveCleanupDependencies
): Effect.Effect<WorkspaceE2EError | undefined, never, E2EDatabase> =>
  Effect.gen(function* () {
    const cleanupErrors: WorkspaceE2EError[] = [];
    const reservationOwners = new Map<
      DotyposReservationId,
      CheckoutFlowState[]
    >();
    const lookupResults = yield* Effect.all(
      flowStates.map((state) => {
        if (state.checkoutRow?.dotypos_reservation_id || !state.orderId) {
          return Effect.succeed({
            exit: Exit.succeed(state.checkoutRow),
            state,
          });
        }

        return Effect.exit(dependencies.readCheckoutRow(state.orderId)).pipe(
          Effect.map((exit) => ({ exit, state }))
        );
      }),
      { concurrency: "unbounded" }
    );

    for (const { exit: rowExit, state } of lookupResults) {
      if (Exit.isFailure(rowExit)) {
        const cause = Cause.squash(rowExit.cause);
        cleanupErrors.push(
          toWorkspaceE2EError("read case-owned checkout cleanup row", cause)
        );
        if (workflowError)
          log(
            `Case-owned Dotypos cleanup row lookup failed: ${redact(String(cause))}`
          );
        continue;
      }

      const row = rowExit.value;
      if (row) state.checkoutRow = row;
      const reservationId = row?.dotypos_reservation_id;
      if (reservationId) {
        const owners = reservationOwners.get(reservationId);
        if (owners) owners.push(state);
        else reservationOwners.set(reservationId, [state]);
      } else if (!state.startedAt) {
        state.cleanupComplete = true;
      }
    }

    const cancellationResults = yield* Effect.all(
      [...reservationOwners].map(([reservationId, owners]) =>
        Effect.exit(
          dependencies.cancelDotyposReservation(datasourceConfig, reservationId)
        ).pipe(Effect.map((exit) => ({ exit, owners })))
      ),
      { concurrency: "unbounded" }
    );

    for (const { exit: cleanupExit, owners } of cancellationResults) {
      if (Exit.isSuccess(cleanupExit)) {
        for (const state of owners) state.cleanupComplete = true;
        continue;
      }

      const cause = Cause.squash(cleanupExit.cause);
      cleanupErrors.push(
        toWorkspaceE2EError("cancel case-owned Dotypos reservation", cause)
      );
      if (workflowError)
        log(`Case-owned Dotypos cleanup failed: ${redact(String(cause))}`);
    }

    return toCleanupError(cleanupErrors);
  });

interface CleanupDependencies {
  readonly cancelDotyposReservation: typeof cancelDotyposReservation;
  readonly readCheckoutRow: typeof readCheckoutRow;
  readonly readCleanupCheckoutRows: typeof readCleanupCheckoutRows;
  readonly waitForCancelledDotyposReservations?: typeof waitForCancelledDotyposReservations;
}

type OwnedCleanupDependencies = Pick<
  CleanupDependencies,
  "cancelDotyposReservation" | "readCheckoutRow"
>;

const liveCleanupDependencies: CleanupDependencies = {
  cancelDotyposReservation,
  readCheckoutRow,
  readCleanupCheckoutRows,
  waitForCancelledDotyposReservations,
};

const getFallbackCleanupQueries = (
  flowStates: readonly CheckoutFlowState[]
): readonly {
  readonly data: CheckoutData;
  readonly startedAt: Date;
}[] => {
  const queries = new Map<
    string,
    { readonly data: CheckoutData; startedAt: Date }
  >();

  for (const state of flowStates) {
    if (state.checkoutRow?.dotypos_reservation_id || !state.startedAt) continue;

    const key = JSON.stringify({
      locale: state.data.locale,
      reservationDetails: state.data.expectedReservationDetails,
    });
    const existing = queries.get(key);
    if (!existing || state.startedAt < existing.startedAt) {
      queries.set(key, { data: state.data, startedAt: state.startedAt });
    }
  }

  return [...queries.values()];
};

const toCleanupError = (
  cleanupErrors: readonly WorkspaceE2EError[]
): WorkspaceE2EError | undefined => {
  if (cleanupErrors.length === 0) return undefined;
  if (cleanupErrors.length === 1) return cleanupErrors[0];
  return workspaceE2EError("Workspace e2e cleanup failed", {
    causes: cleanupErrors,
    operation: "workspace e2e cleanup",
  });
};
