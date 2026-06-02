import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { env } from "@/env";
import { OperationalEventRepositoryLive } from "@/features/checkout/backend/operational-event.repository";
import { ProviderPaymentFinalizationServiceLiveWithDependencies } from "@/features/checkout/backend/provider-payment-finalization.service";
import {
  ReservationHoldCleanupService,
  ReservationHoldCleanupServiceLive,
} from "@/features/checkout/backend/reservation-hold-cleanup.service";
import { WorkspaceReservationRepositoryLive } from "@/features/checkout/backend/workspace-reservation.repository";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

const CronReservationHoldCleanupLive = ReservationHoldCleanupServiceLive.pipe(
  Layer.provide(ProviderPaymentFinalizationServiceLiveWithDependencies),
  Layer.provide(OperationalEventRepositoryLive),
  Layer.provide(WorkspaceReservationRepositoryLive),
  Layer.provide(WorkspaceDatabaseLive),
  Layer.provide(Layer.provide(DotyposService.Default, DotyposRuntimeConfigLive)),
  Layer.orDie
);

const cronBatchLimit = 25;

const isAuthorizedCronRequest = (request: Request) => {
  if (!env.CRON_SECRET) return env.VERCEL_ENV !== "production";

  return request.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
};

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return runWorkspaceEffect(
    Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      const result = yield* cleanup.sweepExpiredHolds({
        now: new Date(),
        limit: cronBatchLimit,
      });

      return NextResponse.json(result);
    }).pipe(
      Effect.provide(CronReservationHoldCleanupLive),
      Effect.catchAll((cause) =>
        Effect.gen(function* () {
          yield* Effect.logError("Reservation hold cleanup cron failed", {
            cause,
          });

          return NextResponse.json(
            { error: "Reservation hold cleanup failed" },
            { status: 500 }
          );
        })
      )
    )
  );
}
