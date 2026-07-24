import { handleCallback } from "@vercel/queue";
import { Effect, Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  processReservationHoldCleanupScheduleMessage,
  ReservationHoldCleanupScheduleService,
  ReservationHoldCleanupServiceLiveWithDependencies,
} from "@/features/checkout/backend/holds";
import { WorkspaceReservationRepositoryLive } from "@/features/reservation/backend/workspace-reservation.repository";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { defineWorkspaceTask } from "@/shared/backend/workspace-effect";

const ReservationHoldCleanupScheduleConsumerLive = Layer.mergeAll(
  ReservationHoldCleanupServiceLiveWithDependencies,
  ReservationHoldCleanupScheduleService.Live,
  WorkspaceReservationRepositoryLive.pipe(Layer.provide(WorkspaceDatabaseLive)),
  DotyposServiceLive
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
