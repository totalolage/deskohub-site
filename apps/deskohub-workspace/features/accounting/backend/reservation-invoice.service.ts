import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import {
  getDotyposCustomerBillingDetails,
  getReservationInvoiceBuyer,
} from "@/features/reservation/reservation-billing";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import { InvoiceRepository } from "./invoice.repository";
import { InvoiceEmailDeliveryService } from "./invoice-email-delivery.service";
import { ReservationInvoiceService } from "./reservation-invoice";

export const ReservationInvoiceServiceLive = Layer.effect(
  ReservationInvoiceService,
  Effect.gen(function* () {
    const accountingSnapshots = yield* AccountingDocumentSnapshotRepository;
    const dotypos = yield* DotyposService;
    const invoiceDeliveries = yield* InvoiceEmailDeliveryService;
    const invoices = yield* InvoiceRepository;

    return ReservationInvoiceService.of({
      processByPaymentAttemptId: Effect.fn(
        "ReservationInvoiceService.processByPaymentAttemptId"
      )(function* ({ paymentAttemptId }) {
        const source =
          yield* accountingSnapshots.findByPaymentAttemptId(paymentAttemptId);
        if (!source?.billing) return;

        const billingDetails = getDotyposCustomerBillingDetails(source.billing);
        if (!billingDetails) return;

        const buyer = getReservationInvoiceBuyer({
          billing: source.billing,
          customerName: source.buyer.legalName,
        });
        if (!buyer) return;

        const existing =
          yield* invoices.findByPaymentAttemptId(paymentAttemptId);
        if (!existing) {
          yield* dotypos.updateCustomerBillingDetails(
            source.dotyposCustomerId,
            billingDetails
          );
        }

        yield* invoices.issue({ paymentAttemptId, buyer });
        yield* invoiceDeliveries.deliverByPaymentAttemptId({
          paymentAttemptId,
        });
      }),
    });
  })
);
