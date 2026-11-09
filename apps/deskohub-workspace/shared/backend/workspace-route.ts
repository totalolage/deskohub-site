import { Data, Effect } from "effect";
import { NextResponse } from "next/server";
import { unclassifiedTraffic } from "@/shared/agent-traffic/agent-traffic";
import {
  runWorkspaceEffect,
  runWorkspaceEffectOrElse,
} from "./workspace-effect";
import { withWorkspaceRequestContext } from "./workspace-request-context";

type WorkspaceRouteCancellation =
  | "interrupt-on-disconnect"
  | "continue-after-disconnect";

export class WorkspaceRouteFailure extends Data.TaggedError(
  "WorkspaceRouteFailure"
)<{
  readonly statusCode: number;
  readonly publicMessage: string;
  /** A stable, machine-readable reason a client can branch on. */
  readonly code?: string;
  readonly cause?: unknown;
}> {
  static internal = (publicMessage: string) => (cause: unknown) =>
    new WorkspaceRouteFailure({
      statusCode: 500,
      publicMessage,
      cause,
    });

  static unavailable =
    (publicMessage: string, code: string) => (cause: unknown) =>
      new WorkspaceRouteFailure({
        statusCode: 503,
        publicMessage,
        code,
        cause,
      });
}

export type WorkspaceRouteErrorResponse = NextResponse<{
  readonly error: string;
  readonly code?: string;
}>;

export interface WorkspaceRouteOptions<A extends Response = Response> {
  /** Stable, low-cardinality name without IDs, URLs, or payload data. */
  readonly operation: string;
  readonly cancellation: WorkspaceRouteCancellation;
  /**
   * Who calls the route. A `service` route, such as a webhook or a cron run,
   * serves no customer request, so its work is unclassified agent traffic
   * rather than the calling service's. A `client` route classifies the
   * request's own headers.
   */
  readonly caller: "client" | "service";
  /**
   * The response for a failure the handler did not answer: a defect, or a
   * shared runtime that could not be built before the handler ran. The
   * failure is logged once with `failureCode`. Interruption, including a
   * client disconnect, and Next.js control flow still propagate. Without it,
   * such a failure rejects and Next.js answers it.
   */
  readonly fallback?: {
    /** Stable, low-cardinality log code without IDs, URLs, or payload data. */
    readonly failureCode: string;
    readonly response: () => A;
  };
}

export const defineWorkspaceRoute =
  <
    Args extends [request: Request, ...rest: readonly unknown[]],
    A extends Response,
  >(
    options: WorkspaceRouteOptions<NoInfer<A>>,
    handler: (...args: Args) => Effect.Effect<A, WorkspaceRouteFailure, never>
  ) =>
  (...args: Args): Promise<A | WorkspaceRouteErrorResponse> => {
    const request = args[0];
    const invocation = Effect.suspend(() => handler(...args)).pipe(
      Effect.catch(recoverWorkspaceRouteFailure),
      withWorkspaceRequestContext(
        request.headers,
        options.caller === "service" ? unclassifiedTraffic : undefined
      )
    );
    const effect = invocation.pipe(
      Effect.annotateLogs({ method: request.method.toUpperCase() })
    );
    const signal =
      options.cancellation === "interrupt-on-disconnect"
        ? request.signal
        : undefined;

    if (options.fallback === undefined) {
      return effect.pipe(
        runWorkspaceEffect(options.operation, { boundary: "route", signal })
      );
    }
    const { failureCode, response } = options.fallback;
    return effect.pipe(
      runWorkspaceEffectOrElse(options.operation, {
        boundary: "route",
        signal,
        failureCode,
        orElse: response,
      })
    );
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
      {
        error: failure.publicMessage,
        ...(failure.code && { code: failure.code }),
      },
      { status: statusCode }
    );
  }
);

const normalizePublicStatus = (statusCode: number) =>
  Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500;
