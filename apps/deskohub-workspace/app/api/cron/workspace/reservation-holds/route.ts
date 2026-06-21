import { Effect } from "effect";
import { NextResponse } from "next/server";
import { env } from "@/env";
import {
  ReservationHoldCleanupService,
  ReservationHoldCleanupServiceLiveWithDependencies,
} from "@/features/checkout/backend/reservation-hold-cleanup.service";
import { runWorkspaceRequestEffect } from "@/shared/backend/logging/censorship";

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
      Effect.provide(ReservationHoldCleanupServiceLiveWithDependencies),
      Effect.catch(handleReservationHoldCleanupCronError)
    )
  );
}
