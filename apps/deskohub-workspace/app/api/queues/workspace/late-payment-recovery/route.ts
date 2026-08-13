import { handleCallback } from "@vercel/queue";
import { Effect, Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database-live.server";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import { AccountingSnapshotKeyServiceLive } from "@/features/accounting/backend/accounting-snapshot-key-live.server";
import { WorkspacePaidFulfillmentServiceLiveWithDependencies } from "@/features/checkout/backend/fulfillment";
import {
  LatePaymentRecoveryServiceLive,
  processLatePaymentRecoveryMessage,
} from "@/features/checkout/backend/payment";
import { LatePaymentRecoveryRepository } from "@/features/checkout/backend/repositories";
import { WorkspaceTableAssignmentService } from "@/features/checkout/backend/reservation";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepositoryLive } from "@/features/reservation/backend/workspace-reservation.repository";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { defineWorkspaceTask } from "@/shared/backend/workspace-effect";

const databaseRepositories = Layer.mergeAll(
  LatePaymentRecoveryRepository.Live,
  AccountingDocumentSnapshotRepository.Live,
  WorkspaceReservationRepositoryLive
).pipe(
  Layer.provide(WorkspaceDatabaseLive),
  Layer.provide(AccountingSnapshotKeyServiceLive)
);

const ConsumerLive = LatePaymentRecoveryServiceLive.pipe(
  Layer.provide(databaseRepositories),
  Layer.provide(WorkspaceAvailabilityService.LiveWithDependencies),
  Layer.provide(
    WorkspaceTableAssignmentService.Live.pipe(
      Layer.provide(databaseRepositories),
      Layer.provide(DotyposServiceLive)
    )
  ),
  Layer.provide(WorkspacePaidFulfillmentServiceLiveWithDependencies),
  Layer.provide(DotyposServiceLive)
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
