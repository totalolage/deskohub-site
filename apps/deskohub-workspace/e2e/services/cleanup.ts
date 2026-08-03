import { Context, type Effect, Layer } from "effect";
import {
  cleanupCheckoutFlowStates,
  cleanupOwnedCheckoutFlowStates,
} from "../cleanup";
import type { DatasourceConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import type { CheckoutFlowState } from "../types";

export interface WorkspaceE2ECleanup {
  readonly cleanupCheckoutStates: (input: {
    readonly datasourceConfig: DatasourceConfig | undefined;
    readonly flowStates: readonly CheckoutFlowState[];
    readonly workflowError: unknown;
  }) => Effect.Effect<WorkspaceE2EError | undefined, never, E2EDatabase>;
  readonly cleanupOwnedCheckoutStates: (input: {
    readonly datasourceConfig: DatasourceConfig;
    readonly flowStates: readonly CheckoutFlowState[];
    readonly workflowError: unknown;
  }) => Effect.Effect<WorkspaceE2EError | undefined, never, E2EDatabase>;
}

export class WorkspaceE2ECleanupService extends Context.Service<
  WorkspaceE2ECleanupService,
  WorkspaceE2ECleanup
>()("WorkspaceE2ECleanupService") {
  static Live = Layer.succeed(this, {
    cleanupCheckoutStates: cleanupCheckoutFlowStates,
    cleanupOwnedCheckoutStates: cleanupOwnedCheckoutFlowStates,
  });
}
