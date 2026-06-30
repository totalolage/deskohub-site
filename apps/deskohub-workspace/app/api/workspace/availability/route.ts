import type { ValidationError } from "@deskohub/dotypos";
import { Effect, Predicate } from "effect";
import { NextResponse } from "next/server";
import {
  WorkspaceAvailabilityService,
  WorkspaceAvailabilityServiceLiveWithDependencies,
} from "@/features/reservation/backend/workspace-availability.service";
import { parseWorkspaceAvailabilityQuery } from "@/features/reservation/schemas/workspace-availability";
import { runWorkspaceRequestEffect } from "@/shared/backend/logging/censorship";

const getAvailabilityRequest = (request: Request) => {
  const { searchParams } = new URL(request.url);
  return parseWorkspaceAvailabilityQuery(searchParams);
};

const loadWorkspaceAvailabilityRequest = Effect.fn(
  "loadWorkspaceAvailabilityRequest"
)(
  function* (request: Request) {
    const query = getAvailabilityRequest(request);
    yield* Effect.annotateLogsScoped({
      query,
      request: {
        headers: Object.fromEntries(request.headers.entries()),
        method: request.method,
        url: request.url,
      },
    });
    yield* Effect.logInfo("Workspace availability request parsed");

    const service = yield* WorkspaceAvailabilityService;
    return yield* service.getAvailability(query);
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.annotateLogs({
        method: "GET",
        operation: "workspaceAvailability",
      })
    )
);

const isValidationError = (cause: unknown): cause is ValidationError =>
  Predicate.isTagged(cause, "ValidationError") &&
  typeof (cause as { message?: unknown }).message === "string";

const handleAvailabilityRouteError = Effect.fn("handleAvailabilityRouteError")(
  function* (cause: unknown) {
    if (isValidationError(cause)) {
      return NextResponse.json({ error: cause.message }, { status: 400 });
    }

    yield* Effect.logError("Workspace availability route failed", { cause });

    return NextResponse.json(
      { error: "Workspace availability could not be loaded" },
      { status: 500 }
    );
  }
);

export async function GET(request: Request): Promise<NextResponse> {
  return runWorkspaceRequestEffect(
    request,
    loadWorkspaceAvailabilityRequest(request).pipe(
      Effect.provide(WorkspaceAvailabilityServiceLiveWithDependencies),
      Effect.tap((result) =>
        Effect.logInfo("Workspace availability response ready", { result })
      ),
      Effect.map((result) => NextResponse.json(result)),
      Effect.catch(handleAvailabilityRouteError)
    )
  );
}
