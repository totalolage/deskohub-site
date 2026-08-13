import type { ValidationError } from "@deskohub/dotypos";
import { Effect, Layer, Predicate } from "effect";
import { NextResponse } from "next/server";
import {
  openPayState,
  ReservationSupersessionService,
  recoverReplacementPayState,
} from "@/features/checkout/backend/checkout";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { recoverReplacementOccupancyExclusion } from "@/features/reservation/backend/workspace-availability-replacement";
import { parseWorkspaceAvailabilityQuery } from "@/features/reservation/workspace-availability";
import { workspaceAvailabilityReplacementHeader } from "@/features/reservation/workspace-availability-request";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

const getAvailabilityQuery = (request: Request) => {
  const { searchParams } = new URL(request.url);
  return parseWorkspaceAvailabilityQuery(searchParams);
};

const getReplacementOccupancyExclusion = Effect.fn(
  "workspaceAvailability.getReplacementOccupancyExclusion"
)(function* (request: Request, query: ReturnType<typeof getAvailabilityQuery>) {
  const token = request.headers
    .get(workspaceAvailabilityReplacementHeader)
    ?.trim();
  if (!token) return undefined;

  const state = yield* openPayState(token).pipe(recoverReplacementPayState);
  if (!state || state.reservation.kind !== query.kind) return undefined;

  const supersessions = yield* ReservationSupersessionService;
  return yield* supersessions
    .findCurrent({
      orderId: state.orderId,
      checkoutSessionId: state.checkoutSessionId,
    })
    .pipe(
      Effect.map((reservation) =>
        reservation
          ? { dotyposReservationId: reservation.dotyposReservationId }
          : undefined
      ),
      recoverReplacementOccupancyExclusion
    );
});

const loadWorkspaceAvailabilityRequest = Effect.fn(
  "loadWorkspaceAvailabilityRequest"
)(function* (request: Request) {
  const query = getAvailabilityQuery(request);
  const occupancyExclusion = yield* getReplacementOccupancyExclusion(
    request,
    query
  );
  yield* Effect.annotateLogsScoped({ query });
  yield* Effect.logInfo("Workspace availability request parsed");

  const service = yield* WorkspaceAvailabilityService;
  return yield* service.getAvailability({ query, occupancyExclusion });
}, Effect.scoped);

const isValidationError = (cause: unknown): cause is ValidationError =>
  Predicate.isTagged(cause, "ValidationError") &&
  Predicate.isString((cause as { message?: unknown }).message);

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

export const GET = defineWorkspaceRoute(
  {
    operation: "workspaceAvailability",
    cancellation: "interrupt-on-disconnect",
  },
  (request) =>
    loadWorkspaceAvailabilityRequest(request).pipe(
      Effect.tap((result) =>
        Effect.logInfo("Workspace availability response ready", { result })
      ),
      Effect.map((result) =>
        NextResponse.json(result, {
          headers: { "Cache-Control": "private, no-store" },
        })
      ),
      Effect.provide(
        Layer.merge(
          WorkspaceAvailabilityService.LiveWithDependencies,
          ReservationSupersessionService.LiveWithDependencies
        )
      ),
      Effect.catch(handleAvailabilityRouteError)
    )
);
