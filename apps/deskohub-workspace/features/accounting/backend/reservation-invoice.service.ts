import { Effect, Layer } from "effect";
import { getReservationInvoiceBuyer } from "@/features/reservation/reservation-billing";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import { InvoiceRepository } from "./invoice.repository";
import { InvoiceEmailDeliveryService } from "./invoice-email-delivery.service";
import { ReservationInvoiceService } from "./reservation-invoice";

export const ReservationInvoiceServiceLive = Layer.effect(
  ReservationInvoiceService,
  Effect.gen(function* () {
    const accountingSnapshots = yield* AccountingDocumentSnapshotRepository;
    const invoiceDeliveries = yield* InvoiceEmailDeliveryService;
    const invoices = yield* InvoiceRepository;

    return ReservationInvoiceService.of({
      processByPaymentAttemptId: Effect.fn(
        "ReservationInvoiceService.processByPaymentAttemptId"
      )(function* ({ paymentAttemptId }) {
        const source =
          yield* accountingSnapshots.findByPaymentAttemptId(paymentAttemptId);
        if (!source?.billing) return;

        const buyer = getReservationInvoiceBuyer({
          billing: source.billing,
          customerName: source.buyer.legalName,
        });
        if (!buyer) return;

        yield* invoices.issue({ paymentAttemptId, buyer });
        yield* invoiceDeliveries.deliverByPaymentAttemptId({
          paymentAttemptId,
        });
      }),
    });
  })
);
