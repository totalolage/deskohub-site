import type { WorkspaceE2EAccountLaneReconciliation } from "../account/reconcile";
import type { PreparedCheckoutFlowCleanup } from "../cleanup";

export type WorkspaceE2ECleanupCandidates = {
  readonly accountLaneJournal:
    | WorkspaceE2EAccountLaneReconciliation
    | undefined;
  readonly checkoutCleanup: PreparedCheckoutFlowCleanup;
};

export const runWorkspaceE2ECleanupWithPreparedCandidates = async <A>({
  readAccountLaneJournal,
  readCheckoutCleanup,
  reconcile,
}: {
  readonly readAccountLaneJournal: () => Promise<
    WorkspaceE2EAccountLaneReconciliation | undefined
  >;
  readonly readCheckoutCleanup: () => Promise<PreparedCheckoutFlowCleanup>;
  readonly reconcile: (candidates: WorkspaceE2ECleanupCandidates) => Promise<A>;
}): Promise<A> => {
  const [checkoutCleanup, accountLaneJournal] = await Promise.all([
    readCheckoutCleanup(),
    readAccountLaneJournal(),
  ]);

  return reconcile({ accountLaneJournal, checkoutCleanup });
};
