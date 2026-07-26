import { Cause, Effect, Exit } from "effect";
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
import { cancelDotyposReservation } from "./integrations/dotypos";
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
    const checkoutRows: CheckoutRow[] = [];

    for (const state of flowStates) {
      if (state.checkoutRow) checkoutRows.push(state.checkoutRow);
      if (
        datasourceConfig &&
        !state.checkoutRow?.dotypos_reservation_id &&
        state.orderId
      ) {
        const orderId = state.orderId;
        const rowExit = yield* Effect.exit(
          dependencies.readCheckoutRow(orderId)
        );
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
    }

    if (datasourceConfig) {
      for (const { data, startedAt } of getFallbackCleanupQueries(flowStates)) {
        const rowExit = yield* Effect.exit(
          dependencies.readCleanupCheckoutRows(startedAt, data)
        );
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
      const seenDotyposReservationIds = new Set<string>();
      for (const row of checkoutRows) {
        const dotyposReservationId = row.dotypos_reservation_id;
        if (
          !dotyposReservationId ||
          seenDotyposReservationIds.has(dotyposReservationId)
        ) {
          continue;
        }
        seenDotyposReservationIds.add(dotyposReservationId);
        const cleanupExit = yield* Effect.exit(
          dependencies.cancelDotyposReservation(
            datasourceConfig,
            dotyposReservationId
          )
        );
        if (Exit.isFailure(cleanupExit)) {
          const cause = Cause.squash(cleanupExit.cause);
          cleanupErrors.push(
            toWorkspaceE2EError("cancel Dotypos checkout reservation", cause)
          );
          if (workflowError)
            log(`Dotypos cleanup failed: ${redact(String(cause))}`);
        }
      }
    }

    if (cleanupErrors.length === 0) return undefined;
    if (cleanupErrors.length === 1) return cleanupErrors[0];
    return workspaceE2EError("Workspace e2e cleanup failed", {
      causes: cleanupErrors,
      operation: "workspace e2e cleanup",
    });
  });

interface CleanupDependencies {
  readonly cancelDotyposReservation: typeof cancelDotyposReservation;
  readonly readCheckoutRow: typeof readCheckoutRow;
  readonly readCleanupCheckoutRows: typeof readCleanupCheckoutRows;
}

const liveCleanupDependencies: CleanupDependencies = {
  cancelDotyposReservation,
  readCheckoutRow,
  readCleanupCheckoutRows,
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
