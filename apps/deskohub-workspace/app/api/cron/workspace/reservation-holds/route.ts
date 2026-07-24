import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { env } from "@/env";
import {
  enqueuePendingProviderAttachmentRecoveries,
  ReservationHoldCleanupScheduleService,
  ReservationHoldCleanupService,
  ReservationHoldCleanupServiceLiveWithDependencies,
} from "@/features/checkout/backend/holds";
import { WorkspaceReservationRepositoryLive } from "@/features/reservation/backend/workspace-reservation.repository";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

const cronBatchLimit = 25;
const ReservationHoldRecoveryCronLive = Layer.mergeAll(
  ReservationHoldCleanupServiceLiveWithDependencies,
  ReservationHoldCleanupScheduleService.Live,
  WorkspaceReservationRepositoryLive.pipe(Layer.provide(WorkspaceDatabaseLive))
);

const isAuthorizedCronRequest = (request: Request) => {
  if (!env.CRON_SECRET) return env.VERCEL_ENV === "development";

  return request.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
};

const sweepExpiredReservationHolds = Effect.fn("sweepExpiredReservationHolds")(
  function* () {
    const cleanup = yield* ReservationHoldCleanupService;
    const input = {
      now: Temporal.Now.instant(),
      limit: cronBatchLimit,
    };
    yield* Effect.annotateLogsScoped({ input });
    yield* Effect.logInfo("Reservation hold cleanup sweep started");

    const result = yield* cleanup.sweepExpiredHolds(input);
    const providerAttachmentRecovery =
      yield* enqueuePendingProviderAttachmentRecoveries(input);
    yield* Effect.annotateLogsScoped({ result });
    yield* Effect.logInfo("Reservation hold cleanup sweep completed");

    return NextResponse.json({ ...result, providerAttachmentRecovery });
  },
  Effect.scoped
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

export const GET = defineWorkspaceRoute(
  {
    operation: "reservationHoldCleanupCron",
    cancellation: "continue-after-disconnect",
  },
  (request) => {
    if (!isAuthorizedCronRequest(request)) {
      return Effect.logWarning(
        "Unauthorized reservation hold cleanup cron request"
      ).pipe(
        Effect.as(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
      );
    }

    return sweepExpiredReservationHolds().pipe(
      Effect.provide(ReservationHoldRecoveryCronLive),
      Effect.catch(handleReservationHoldCleanupCronError)
    );
  }
);
