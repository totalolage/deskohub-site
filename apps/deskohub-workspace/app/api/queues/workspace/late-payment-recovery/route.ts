import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import { AccountingSnapshotKeyService } from "@/features/accounting/backend/accounting-snapshot-key.service";
import { ReservationFulfillment } from "@/features/checkout/backend/fulfillment";
import {
  LatePaymentRecoveryService,
  latePaymentRecoveryTopic,
  processLatePaymentRecoveryMessage,
} from "@/features/checkout/backend/payment";
import { LatePaymentRecoveryRepository } from "@/features/checkout/backend/repositories";
import { WorkspaceTableAssignmentService } from "@/features/checkout/backend/reservation";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";

export const maxDuration = 300;

const databaseRepositories = Layer.mergeAll(
  LatePaymentRecoveryRepository.Default,
  AccountingDocumentSnapshotRepository.Default,
  WorkspaceReservationRepository.Default
).pipe(
  Layer.provide(
    Layer.mergeAll(
      WorkspaceDatabase.Default,
      AccountingSnapshotKeyService.Default
    )
  )
);

const ConsumerLive = LatePaymentRecoveryService.Default.pipe(
  Layer.provide(databaseRepositories),
  Layer.provide(WorkspaceAvailabilityService.Live),
  Layer.provide(
    WorkspaceTableAssignmentService.Default.pipe(
      Layer.provide(databaseRepositories),
      Layer.provide(WorkspaceDotyposLayer)
    )
  ),
  Layer.provide(ReservationFulfillment.Live),
  Layer.provide(WorkspaceDotyposLayer)
);

export const POST = latePaymentRecoveryTopic.consume(
  "latePaymentRecoveryQueue",
  (message) =>
    processLatePaymentRecoveryMessage(message).pipe(
      Effect.provide(ConsumerLive)
    )
);
