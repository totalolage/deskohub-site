import { Effect, Option } from "effect";
import type { WorkspaceE2EAccountLaneReconciliation } from "../account/reconcile";
import type { PreparedCheckoutFlowCleanup } from "../cleanup";
import type { WorkspaceE2EError } from "../errors";
import { E2ETelemetryService } from "../services/telemetry";

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

export const traceWorkspaceE2ESuiteCleanup = <E, R1, R2>({
  cleanupCheckout,
  reconcileAccountLane,
}: {
  readonly cleanupCheckout: Effect.Effect<
    WorkspaceE2EError | undefined,
    never,
    R1
  >;
  readonly reconcileAccountLane: Effect.Effect<void, E, R2>;
}): Effect.Effect<void, WorkspaceE2EError | E, E2ETelemetryService | R1 | R2> =>
  Effect.gen(function* () {
    const telemetry = yield* E2ETelemetryService;
    yield* telemetry.tracePhase({
      effect: cleanupCheckout.pipe(
        Effect.tap(() => reconcileAccountLane),
        Effect.flatMap((checkoutError) =>
          Option.match(Option.fromUndefinedOr(checkoutError), {
            onNone: () => Effect.void,
            onSome: Effect.fail,
          })
        )
      ),
      phaseId: "suite-cleanup",
    });
  });
