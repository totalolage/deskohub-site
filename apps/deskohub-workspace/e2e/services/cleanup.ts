import { Context, type Effect, Layer } from "effect";
import { cleanupCheckoutFlowStates } from "../cases";
import type { DatasourceConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import type { CheckoutFlowState } from "../types";

interface IWorkspaceE2ECleanupService {
  readonly cleanupCheckoutStates: (input: {
    readonly datasourceConfig: DatasourceConfig | undefined;
    readonly flowStates: readonly CheckoutFlowState[];
    readonly workflowError: unknown;
  }) => Effect.Effect<WorkspaceE2EError | undefined, never>;
}

export class WorkspaceE2ECleanupService extends Context.Service<
  WorkspaceE2ECleanupService,
  IWorkspaceE2ECleanupService
>()("WorkspaceE2ECleanupService") {
  static Live = Layer.succeed(this, {
    cleanupCheckoutStates: cleanupCheckoutFlowStates,
  });
}
