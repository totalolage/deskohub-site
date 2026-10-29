import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  processReservationHoldCleanupScheduleMessage,
  ReservationHoldCleanupService,
  reservationHoldCleanupRedelivery,
  reservationHoldCleanupTopic,
} from "@/features/checkout/backend/holds";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";

const ReservationHoldCleanupScheduleConsumerLive = Layer.mergeAll(
  ReservationHoldCleanupService.Live,
  WorkspaceReservationRepository.Default.pipe(
    Layer.provide(WorkspaceDatabase.Default)
  )
);

export const POST = reservationHoldCleanupTopic.consume(
  "reservationHoldCleanupSchedule",
  (message) =>
    processReservationHoldCleanupScheduleMessage(message).pipe(
      Effect.provide(ReservationHoldCleanupScheduleConsumerLive)
    ),
  reservationHoldCleanupRedelivery
);
