import { Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database-live.server";
import { WorkspaceReservationRepositoryLive } from "@/features/reservation/backend/workspace-reservation.repository";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import { AccountingSnapshotKeyServiceLive } from "./accounting-snapshot-key-live.server";
import { InvoiceRepository } from "./invoice.repository";
import { InvoiceEmailDeliveryServiceLiveWithDependencies } from "./invoice-email-delivery-live.server";
import { ReservationInvoiceServiceLive } from "./reservation-invoice.service";

const accountingStorageLive = Layer.merge(
  WorkspaceDatabaseLive,
  AccountingSnapshotKeyServiceLive
);
const accountingSnapshotsLive = AccountingDocumentSnapshotRepository.Live.pipe(
  Layer.provide(accountingStorageLive)
);
const invoicesLive = InvoiceRepository.Live.pipe(
  Layer.provide(Layer.merge(accountingStorageLive, accountingSnapshotsLive))
);
export const ReservationInvoiceServiceLiveWithDependencies =
  ReservationInvoiceServiceLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        accountingSnapshotsLive,
        DotyposServiceLive,
        invoicesLive,
        WorkspaceReservationRepositoryLive.pipe(
          Layer.provide(WorkspaceDatabaseLive)
        ),
        InvoiceEmailDeliveryServiceLiveWithDependencies
      )
    ),
    Layer.orDie
  );
