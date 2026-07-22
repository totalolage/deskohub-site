import { Data, Effect } from "effect";
import { NextResponse } from "next/server";

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

export const mapWorkspaceInternalRouteFailure = (publicMessage: string) =>
  function mapFailure(cause: unknown) {
    return new WorkspaceRouteFailure({
      statusCode: 500,
      publicMessage,
      cause,
    });
  };

export const recoverWorkspaceRouteFailure = Effect.fn(
  "workspaceEffect.recoverRouteFailure"
)(function* (failure: WorkspaceRouteFailure) {
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
});

const normalizePublicStatus = (statusCode: number) =>
  Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500;
