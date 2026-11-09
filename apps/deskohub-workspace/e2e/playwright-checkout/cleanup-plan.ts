import { Effect, Option } from "effect";
import type { WorkspaceE2EAccountLaneReconciliation } from "../account/reconcile";
import type { PreparedCheckoutFlowCleanup } from "../cleanup";
import type { WorkspaceE2EError } from "../errors";
import { E2ETelemetryService } from "../services/telemetry";

export type WorkspaceE2ECleanupCandidates = {
  /** The account lane's and every referral-lane case's identity journal. */
  readonly accountJournals: readonly WorkspaceE2EAccountLaneReconciliation[];
  readonly checkoutCleanup: PreparedCheckoutFlowCleanup;
};

export const runWorkspaceE2ECleanupWithPreparedCandidates = async <A>({
  readAccountJournals,
  readCheckoutCleanup,
  reconcile,
}: {
  readonly readAccountJournals: () => Promise<
    readonly WorkspaceE2EAccountLaneReconciliation[]
  >;
  readonly readCheckoutCleanup: () => Promise<PreparedCheckoutFlowCleanup>;
  readonly reconcile: (candidates: WorkspaceE2ECleanupCandidates) => Promise<A>;
}): Promise<A> => {
  const [checkoutCleanup, accountJournals] = await Promise.all([
    readCheckoutCleanup(),
    readAccountJournals(),
  ]);

  return reconcile({ accountJournals, checkoutCleanup });
};

export const traceWorkspaceE2ESuiteCleanup = <E, R1, R2>({
  cleanupCheckout,
  reconcileAccountJournals,
}: {
  readonly cleanupCheckout: Effect.Effect<
    WorkspaceE2EError | undefined,
    never,
    R1
  >;
  readonly reconcileAccountJournals: Effect.Effect<void, E, R2>;
}): Effect.Effect<void, WorkspaceE2EError | E, E2ETelemetryService | R1 | R2> =>
  Effect.gen(function* () {
    const telemetry = yield* E2ETelemetryService;
    yield* telemetry.tracePhase({
      effect: cleanupCheckout.pipe(
        Effect.tap(() => reconcileAccountJournals),
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
