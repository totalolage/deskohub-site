import { handleCallback } from "@vercel/queue";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import { AccountingSnapshotKeyService } from "@/features/accounting/backend/accounting-snapshot-key.service";
import { WorkspacePaidFulfillmentService } from "@/features/checkout/backend/fulfillment";
import {
  LatePaymentRecoveryService,
  processLatePaymentRecoveryMessage,
} from "@/features/checkout/backend/payment";
import { LatePaymentRecoveryRepository } from "@/features/checkout/backend/repositories";
import { WorkspaceTableAssignmentService } from "@/features/checkout/backend/reservation";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { defineWorkspaceTask } from "@/shared/backend/workspace-effect";

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
  Layer.provide(WorkspacePaidFulfillmentService.Live),
  Layer.provide(WorkspaceDotyposLayer)
);

const processMessage = defineWorkspaceTask(
  "latePaymentRecoveryQueue",
  (message: Parameters<typeof processLatePaymentRecoveryMessage>[0]) =>
    processLatePaymentRecoveryMessage(message).pipe(
      Effect.asVoid,
      Effect.provide(ConsumerLive)
    )
);

export const POST = handleCallback((message, _metadata) =>
  processMessage(message)
);
