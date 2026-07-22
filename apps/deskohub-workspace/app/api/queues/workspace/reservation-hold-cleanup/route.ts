import { handleCallback } from "@vercel/queue";
import { Effect, Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  processReservationHoldCleanupScheduleMessage,
  ReservationHoldCleanupServiceLiveWithDependencies,
} from "@/features/checkout/backend/holds";
import { WorkspaceReservationRepositoryLive } from "@/features/reservation/backend/workspace-reservation.repository";
import { defineWorkspaceTask } from "@/shared/backend/workspace-effect";

const ReservationHoldCleanupScheduleConsumerLive = Layer.mergeAll(
  ReservationHoldCleanupServiceLiveWithDependencies,
  WorkspaceReservationRepositoryLive.pipe(Layer.provide(WorkspaceDatabaseLive))
);

const processCleanupMessage = defineWorkspaceTask(
  "reservationHoldCleanupSchedule",
  (
    message: Parameters<typeof processReservationHoldCleanupScheduleMessage>[0]
  ) =>
    processReservationHoldCleanupScheduleMessage(message).pipe(
      Effect.asVoid,
      Effect.provide(ReservationHoldCleanupScheduleConsumerLive)
    )
);

export const POST = handleCallback((message, _metadata) =>
  processCleanupMessage(message)
);
