import { DotyposService, ValidationError } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { OperationalEventRepositoryLive } from "@/features/checkout/backend/operational-event.repository";
import { ProviderPaymentFinalizationServiceLiveWithDependencies } from "@/features/checkout/backend/provider-payment-finalization.service";
import { ReservationHoldCleanupServiceLive } from "@/features/checkout/backend/reservation-hold-cleanup.service";
import { WorkspaceReservationRepositoryLive } from "@/features/checkout/backend/workspace-reservation.repository";
import {
  parseWorkspaceAvailabilityQuery,
  WorkspaceAvailabilityService,
  WorkspaceAvailabilityServiceLive,
} from "@/features/reservation/backend/workspace-availability.service";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

const AvailabilityRouteLive = WorkspaceAvailabilityServiceLive.pipe(
  Layer.provide(ReservationHoldCleanupServiceLive),
  Layer.provide(ProviderPaymentFinalizationServiceLiveWithDependencies),
  Layer.provide(OperationalEventRepositoryLive),
  Layer.provide(WorkspaceReservationRepositoryLive),
  Layer.provide(WorkspaceDatabaseLive),
  Layer.provide(Layer.provide(DotyposService.Default, DotyposRuntimeConfigLive))
);

const getAvailabilityRequest = (request: Request) => {
  const { searchParams } = new URL(request.url);
  return parseWorkspaceAvailabilityQuery(searchParams);
};

const loadWorkspaceAvailability = Effect.fn("loadWorkspaceAvailability")(
  function* (request: Request) {
    const availability = yield* WorkspaceAvailabilityService;
    return yield* availability.getAvailability(getAvailabilityRequest(request));
  },
  (effect) =>
    effect.pipe(
      Effect.annotateLogs({
        method: "GET",
        operation: "workspaceAvailability",
      })
    )
);

const handleAvailabilityRouteError = Effect.fn("handleAvailabilityRouteError")(
  function* (cause: unknown) {
    if (cause instanceof ValidationError) {
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
  return runWorkspaceEffect(
    loadWorkspaceAvailability(request).pipe(
      Effect.provide(AvailabilityRouteLive),
      Effect.map((result) => NextResponse.json(result)),
      Effect.catchAll(handleAvailabilityRouteError)
    )
  );
}
