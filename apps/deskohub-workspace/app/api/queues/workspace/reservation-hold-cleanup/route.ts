import { handleCallback } from "@vercel/queue";
import { Effect, Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { ReservationHoldCleanupServiceLiveWithDependencies } from "@/features/checkout/backend/reservation-hold-cleanup.service";
import { processReservationHoldCleanupScheduleMessage } from "@/features/checkout/backend/reservation-hold-cleanup-queue.service";
import { WorkspaceReservationRepositoryLive } from "@/features/reservation/backend/workspace-reservation.repository";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

const ReservationHoldCleanupScheduleConsumerLive = Layer.mergeAll(
  ReservationHoldCleanupServiceLiveWithDependencies,
  WorkspaceReservationRepositoryLive.pipe(Layer.provide(WorkspaceDatabaseLive))
);

export const POST = handleCallback(async (message) => {
  await runWorkspaceEffect(
    processReservationHoldCleanupScheduleMessage(message).pipe(
      Effect.provide(ReservationHoldCleanupScheduleConsumerLive),
      Effect.annotateLogs({ operation: "reservationHoldCleanupSchedule" })
    )
  );
});
