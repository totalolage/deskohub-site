import type { ValidationError } from "@deskohub/dotypos";
import { Effect, Predicate } from "effect";
import { NextResponse } from "next/server";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { parseWorkspaceAvailabilityQuery } from "@/features/reservation/workspace-availability";
import {
  mapWorkspaceInternalRouteFailure,
  WorkspaceEffect,
} from "@/shared/backend/workspace-effect";

const getAvailabilityRequest = (request: Request) => {
  const { searchParams } = new URL(request.url);
  return parseWorkspaceAvailabilityQuery(searchParams);
};

const loadWorkspaceAvailabilityRequest = Effect.fn(
  "loadWorkspaceAvailabilityRequest"
)(function* (request: Request) {
  const query = getAvailabilityRequest(request);
  yield* Effect.annotateLogsScoped({ query });
  yield* Effect.logInfo("Workspace availability request parsed");

  const service = yield* WorkspaceAvailabilityService;
  return yield* service.getAvailability(query);
}, Effect.scoped);

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

export const GET = WorkspaceEffect.route(
  {
    operation: "workspace.availability",
    cancellation: "interrupt-on-disconnect",
    layer: WorkspaceAvailabilityService.LiveWithDependencies,
    mapFailure: mapWorkspaceInternalRouteFailure(
      "Workspace availability could not be loaded"
    ),
  },
  (request) =>
    loadWorkspaceAvailabilityRequest(request).pipe(
      Effect.tap((result) =>
        Effect.logInfo("Workspace availability response ready", { result })
      ),
      Effect.map((result) => NextResponse.json(result)),
      Effect.catch(handleAvailabilityRouteError)
    )
);
