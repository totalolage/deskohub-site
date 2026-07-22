import { handleCallback } from "@vercel/queue";
import { Effect, Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  processReservationHoldCleanupScheduleMessage,
  ReservationHoldCleanupServiceLiveWithDependencies,
} from "@/features/checkout/backend/holds";
import { WorkspaceReservationRepositoryLive } from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";

const ReservationHoldCleanupScheduleConsumerLive = Layer.mergeAll(
  ReservationHoldCleanupServiceLiveWithDependencies,
  WorkspaceReservationRepositoryLive.pipe(Layer.provide(WorkspaceDatabaseLive))
);

const processCleanupMessage = WorkspaceEffect.task(
  {
    operation: "reservationHoldCleanupSchedule",
    layer: ReservationHoldCleanupScheduleConsumerLive,
  },
  (
    message: Parameters<typeof processReservationHoldCleanupScheduleMessage>[0]
  ) => processReservationHoldCleanupScheduleMessage(message).pipe(Effect.asVoid)
);

export const POST = handleCallback((message, _metadata) =>
  processCleanupMessage(message)
);
