import { handleCallback } from "@vercel/queue";
import { Effect, Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  processReservationHoldCleanupScheduleMessage,
  ReservationHoldCleanupServiceLiveWithDependencies,
} from "@/features/checkout/backend/holds";
import { WorkspaceReservationRepositoryLive } from "@/features/reservation/backend/workspace-reservation.repository";
import { runWorkspace } from "@/shared/backend/logging/censorship";

const ReservationHoldCleanupScheduleConsumerLive = Layer.mergeAll(
  ReservationHoldCleanupServiceLiveWithDependencies,
  WorkspaceReservationRepositoryLive.pipe(Layer.provide(WorkspaceDatabaseLive))
);

export const POST = handleCallback(async (message) => {
  await runWorkspace(
    processReservationHoldCleanupScheduleMessage(message).pipe(
      Effect.provide(ReservationHoldCleanupScheduleConsumerLive),
      Effect.annotateLogs({ operation: "reservationHoldCleanupSchedule" })
    )
  );
});
