import { Effect } from "effect";
import { ReservationHoldCleanupService } from "@/features/checkout/backend/holds";
import { defineWorkspaceCron } from "@/shared/backend/service-route";

const cronBatchLimit = 25;

export const GET = defineWorkspaceCron({
  operation: "reservationHoldCleanupCron",
  failureMessage: "Reservation hold cleanup failed",
  input: () => ({ now: Temporal.Now.instant(), limit: cronBatchLimit }),
  run: (input) =>
    Effect.flatMap(ReservationHoldCleanupService, (cleanup) =>
      cleanup.sweepExpiredHolds(input)
    ).pipe(Effect.provide(ReservationHoldCleanupService.Live)),
});
