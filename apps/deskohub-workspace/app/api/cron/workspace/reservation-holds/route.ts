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
import { WorkspaceReservationRepositoryLive } from "@/features/reservation/backend/workspace-reservation.repository";
import { PostHogEventServiceLive } from "@/shared/backend/analytics/posthog-event.service";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { runWorkspaceRequestEffect } from "@/shared/backend/logging/censorship";

const CronReservationHoldCleanupLive = ReservationHoldCleanupServiceLive.pipe(
  Layer.provide(ProviderPaymentFinalizationServiceLiveWithDependencies),
  Layer.provide(OperationalEventRepositoryLive),
  Layer.provide(PostHogEventServiceLive),
  Layer.provide(WorkspaceReservationRepositoryLive),
  Layer.provide(WorkspaceDatabaseLive),
  Layer.provide(Layer.provide(DotyposService.Default, DotyposRuntimeConfigLive))
);

const cronBatchLimit = 25;

const isAuthorizedCronRequest = (request: Request) => {
  if (!env.CRON_SECRET) return env.VERCEL_ENV === "development";

  return request.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
};

const sweepExpiredReservationHolds = Effect.fn("sweepExpiredReservationHolds")(
  function* () {
    const cleanup = yield* ReservationHoldCleanupService;
    const input = {
      now: new Date(),
      limit: cronBatchLimit,
    };
    yield* Effect.annotateLogsScoped({ input });
    yield* Effect.logInfo("Reservation hold cleanup sweep started");

    const result = yield* cleanup.sweepExpiredHolds(input);
    yield* Effect.annotateLogsScoped({ result });
    yield* Effect.logInfo("Reservation hold cleanup sweep completed");

    return NextResponse.json(result);
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.annotateLogs({
        method: "GET",
        operation: "reservationHoldCleanupCron",
      })
    )
);

const handleReservationHoldCleanupCronError = Effect.fn(
  "handleReservationHoldCleanupCronError"
)(function* (cause: unknown) {
  yield* Effect.logError("Reservation hold cleanup cron failed", {
    cause,
  });

  return NextResponse.json(
    { error: "Reservation hold cleanup failed" },
    { status: 500 }
  );
});

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    await runWorkspaceRequestEffect(
      request,
      Effect.logWarning("Unauthorized reservation hold cleanup cron request", {
        request: {
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
          url: request.url,
        },
      }).pipe(
        Effect.annotateLogs({
          method: "GET",
          operation: "reservationHoldCleanupCron",
        })
      )
    );

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return runWorkspaceRequestEffect(
    request,
    sweepExpiredReservationHolds().pipe(
      Effect.provide(CronReservationHoldCleanupLive),
      Effect.catchAll(handleReservationHoldCleanupCronError)
    )
  );
}
