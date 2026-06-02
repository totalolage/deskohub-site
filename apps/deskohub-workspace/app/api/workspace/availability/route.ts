import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { PaymentOrderRepositoryLive } from "@/features/checkout/backend/payment-order.repository";
import { ReservationHoldCleanupServiceLive } from "@/features/checkout/backend/reservation-hold-cleanup.service";
import {
  parseWorkspaceAvailabilityQuery,
  WorkspaceAvailabilityService,
  WorkspaceAvailabilityServiceLive,
} from "@/features/reservation/backend/workspace-availability.service";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

const AvailabilityRouteLive = WorkspaceAvailabilityServiceLive.pipe(
  Layer.provide(ReservationHoldCleanupServiceLive),
  Layer.provide(PaymentOrderRepositoryLive),
  Layer.provide(WorkspaceDatabaseLive),
  Layer.provide(
    Layer.provide(DotyposService.Default, DotyposRuntimeConfigLive)
  )
);

const getAvailabilityRequest = (request: Request) => {
  const { searchParams } = new URL(request.url);
  return parseWorkspaceAvailabilityQuery(searchParams);
};

export async function GET(request: Request): Promise<NextResponse> {
  return runWorkspaceEffect(
    Effect.gen(function* () {
      const availability = yield* WorkspaceAvailabilityService;
      return yield* availability.getAvailability(getAvailabilityRequest(request));
    }).pipe(
      Effect.provide(AvailabilityRouteLive),
      Effect.map((result) => NextResponse.json(result)),
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Effect.logError("Workspace availability route failed", {
            cause: error,
          });

          return NextResponse.json(
            { error: "Workspace availability could not be loaded" },
            { status: 500 }
          );
        })
      )
    )
  );
}
