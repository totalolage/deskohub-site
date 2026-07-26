import { Cause, Data, Effect } from "effect";

export type WorkspaceFrameworkBoundary = "action" | "route" | "task";

export class WorkspaceFrameworkFailure extends Data.TaggedError(
  "WorkspaceFrameworkFailure"
)<{
  readonly boundary: WorkspaceFrameworkBoundary;
  readonly kind: "defect";
}> {}

export const normalizeWorkspaceFrameworkDefects =
  (boundary: WorkspaceFrameworkBoundary) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E | WorkspaceFrameworkFailure, R> =>
    Effect.catchCause(effect, (cause) => {
      if (Cause.hasDies(cause)) {
        return Effect.fail(
          new WorkspaceFrameworkFailure({ boundary, kind: "defect" })
        ) as Effect.Effect<never, E | WorkspaceFrameworkFailure>;
      }
      return Effect.failCause(cause) as Effect.Effect<
        never,
        E | WorkspaceFrameworkFailure
      >;
    });
