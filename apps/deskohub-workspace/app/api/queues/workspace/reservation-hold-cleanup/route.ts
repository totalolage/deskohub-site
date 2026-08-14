import { handleCallback } from "@vercel/queue";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  processReservationHoldCleanupScheduleMessage,
  ReservationHoldCleanupService,
} from "@/features/checkout/backend/holds";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { defineWorkspaceTask } from "@/shared/backend/workspace-effect";

const ReservationHoldCleanupScheduleConsumerLive = Layer.mergeAll(
  ReservationHoldCleanupService.LiveWithDependencies,
  WorkspaceReservationRepository.Live.pipe(
    Layer.provide(WorkspaceDatabase.Live)
  )
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
