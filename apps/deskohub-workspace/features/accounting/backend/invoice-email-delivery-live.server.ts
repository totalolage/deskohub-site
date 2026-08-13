import { StandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database-live.server";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import { AccountingSnapshotKeyServiceLive } from "./accounting-snapshot-key-live.server";
import { InvoiceRepository } from "./invoice.repository";
import { InvoiceEmailDeliveryRepository } from "./invoice-email-delivery.repository";
import { InvoiceEmailDeliveryService } from "./invoice-email-delivery.service";

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

export const InvoiceEmailDeliveryServiceLiveWithDependencies =
  InvoiceEmailDeliveryService.Live.pipe(
    Layer.provide(
      Layer.mergeAll(
        accountingSnapshotsLive,
        invoicesLive,
        InvoiceEmailDeliveryRepository.Live.pipe(
          Layer.provide(WorkspaceDatabaseLive)
        ),
        Layer.provideMerge(StandaloneEmailServiceLayer, EmailConfigLayer)
      )
    )
  );
