import { StandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database-live.server";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import { AccountingSnapshotKeyServiceLive } from "./accounting-snapshot-key-live.server";
import { InvoiceRepository } from "./invoice.repository";
import { InvoiceEmailDeliveryRepository } from "./invoice-email-delivery.repository";
import { InvoiceEmailDeliveryService } from "./invoice-email-delivery.service";
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
const invoiceDeliveriesLive = InvoiceEmailDeliveryRepository.Live.pipe(
  Layer.provide(WorkspaceDatabaseLive)
);
const emailLive = Layer.provideMerge(
  StandaloneEmailServiceLayer,
  EmailConfigLayer
);
const invoiceEmailDeliveryLive = InvoiceEmailDeliveryService.Live.pipe(
  Layer.provide(
    Layer.mergeAll(
      accountingSnapshotsLive,
      invoicesLive,
      invoiceDeliveriesLive,
      emailLive
    )
  )
);

export const ReservationInvoiceServiceLiveWithDependencies =
  ReservationInvoiceServiceLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        accountingSnapshotsLive,
        DotyposServiceLive,
        invoicesLive,
        invoiceEmailDeliveryLive
      )
    ),
    Layer.orDie
  );
