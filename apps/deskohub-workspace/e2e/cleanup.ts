import { Cause, Effect, Exit } from "effect";
import type { DatasourceConfig } from "./config";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "./errors";
import {
  readCleanupCheckoutRow,
  readLatestCleanupCheckoutRow,
} from "./integrations/database";
import { cancelDotyposReservation } from "./integrations/dotypos";
import { log, redact } from "./runtime";
import type { CheckoutFlowState } from "./types";

export const cleanupCheckoutFlowStates = ({
  datasourceConfig,
  flowStates,
  workflowError,
}: {
  datasourceConfig: DatasourceConfig | undefined;
  flowStates: readonly CheckoutFlowState[];
  workflowError: unknown;
}): Effect.Effect<WorkspaceE2EError | undefined, never> =>
  Effect.gen(function* () {
    const cleanupErrors: WorkspaceE2EError[] = [];

    for (const state of flowStates) {
      if (
        datasourceConfig &&
        !state.checkoutRow?.dotypos_reservation_id &&
        state.orderId
      ) {
        const orderId = state.orderId;
        const rowExit = yield* Effect.exit(
          readCleanupCheckoutRow(datasourceConfig, orderId)
        );
        if (Exit.isSuccess(rowExit)) {
          state.checkoutRow = rowExit.value;
        } else {
          const cause = Cause.squash(rowExit.cause);
          cleanupErrors.push(
            toWorkspaceE2EError("read checkout cleanup row", cause)
          );
          if (workflowError)
            log(`Dotypos cleanup row lookup failed: ${redact(String(cause))}`);
        }
      }
      if (
        datasourceConfig &&
        !state.checkoutRow?.dotypos_reservation_id &&
        state.startedAt
      ) {
        const startedAt = state.startedAt;
        const rowExit = yield* Effect.exit(
          readLatestCleanupCheckoutRow(datasourceConfig, startedAt, state.data)
        );
        if (Exit.isSuccess(rowExit)) {
          state.checkoutRow = rowExit.value;
        } else {
          const cause = Cause.squash(rowExit.cause);
          cleanupErrors.push(
            toWorkspaceE2EError("read latest checkout cleanup row", cause)
          );
          if (workflowError)
            log(
              `Dotypos fallback cleanup row lookup failed: ${redact(String(cause))}`
            );
        }
      }
      if (datasourceConfig && state.checkoutRow?.dotypos_reservation_id) {
        const dotyposReservationId = state.checkoutRow.dotypos_reservation_id;
        const cleanupExit = yield* Effect.exit(
          cancelDotyposReservation(datasourceConfig, dotyposReservationId)
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
