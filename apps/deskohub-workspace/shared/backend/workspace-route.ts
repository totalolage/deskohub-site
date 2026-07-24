import { Data, Effect } from "effect";
import { NextResponse } from "next/server";
import {
  runWorkspaceEffect,
  scheduleWorkspaceTelemetryFlush,
} from "./workspace-effect";
import { withWorkspaceRequestContext } from "./workspace-request-context";

export type WorkspaceRouteCancellation =
  | "interrupt-on-disconnect"
  | "continue-after-disconnect";

export class WorkspaceRouteFailure extends Data.TaggedError(
  "WorkspaceRouteFailure"
)<{
  readonly statusCode: number;
  readonly publicMessage: string;
  readonly cause?: unknown;
}> {}

export type WorkspaceRouteErrorResponse = NextResponse<{
  readonly error: string;
}>;

export interface WorkspaceRouteOptions {
  /** Stable, low-cardinality name without IDs, URLs, or payload data. */
  readonly operation: string;
  readonly cancellation: WorkspaceRouteCancellation;
}

export const defineWorkspaceRoute =
  <
    Args extends [request: Request, ...rest: readonly unknown[]],
    A extends Response,
  >(
    options: WorkspaceRouteOptions,
    handler: (...args: Args) => Effect.Effect<A, WorkspaceRouteFailure, never>
  ) =>
  (...args: Args): Promise<A | WorkspaceRouteErrorResponse> => {
    const request = args[0];
    const invocation = Effect.suspend(() => handler(...args)).pipe(
      Effect.catch(recoverWorkspaceRouteFailure),
      withWorkspaceRequestContext(request.headers)
    );
    const effect = Effect.andThen(
      scheduleWorkspaceTelemetryFlush,
      invocation
    ).pipe(Effect.annotateLogs({ method: request.method.toUpperCase() }));
    const signal =
      options.cancellation === "interrupt-on-disconnect"
        ? request.signal
        : undefined;

    return effect.pipe(
      runWorkspaceEffect(options.operation, { boundary: "route", signal })
    );
  };

export const mapWorkspaceInternalRouteFailure = (publicMessage: string) =>
  function mapFailure(cause: unknown) {
    return new WorkspaceRouteFailure({
      statusCode: 500,
      publicMessage,
      cause,
    });
  };

const recoverWorkspaceRouteFailure = Effect.fn("workspaceRoute.recoverFailure")(
  function* (failure: WorkspaceRouteFailure) {
    const statusCode = normalizePublicStatus(failure.statusCode);
    const annotations = {
      statusCode,
      cause: failure.cause,
    };

    yield* statusCode >= 400 && statusCode < 500
      ? Effect.logWarning("Workspace route request was rejected", annotations)
      : Effect.logError("Workspace route request failed", annotations);

    return NextResponse.json(
      { error: failure.publicMessage },
      { status: statusCode }
    );
  }
);

const normalizePublicStatus = (statusCode: number) =>
  Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500;
