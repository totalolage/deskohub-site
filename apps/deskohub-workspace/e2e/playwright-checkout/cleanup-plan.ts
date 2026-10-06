import type { WorkspaceE2EAccountLaneReconciliation } from "../account/reconcile";
import type { CheckoutFlowState } from "../types";

export type WorkspaceE2ECleanupCandidates = {
  readonly accountLaneJournal:
    | WorkspaceE2EAccountLaneReconciliation
    | undefined;
  readonly checkoutFlowStates: readonly CheckoutFlowState[];
};

export const runWorkspaceE2ECleanupWithPreparedCandidates = async <A>({
  readAccountLaneJournal,
  readCheckoutFlowStates,
  reconcile,
}: {
  readonly readAccountLaneJournal: () => Promise<
    WorkspaceE2EAccountLaneReconciliation | undefined
  >;
  readonly readCheckoutFlowStates: () => Promise<readonly CheckoutFlowState[]>;
  readonly reconcile: (candidates: WorkspaceE2ECleanupCandidates) => Promise<A>;
}): Promise<A> => {
  const [checkoutFlowStates, accountLaneJournal] = await Promise.all([
    readCheckoutFlowStates(),
    readAccountLaneJournal(),
  ]);

  return reconcile({ accountLaneJournal, checkoutFlowStates });
};
