import { Effect, Option } from "effect";
import {
  DeliveryReportError,
  deliveryReportHandler,
  ignoredDeliveryReport,
  processedDeliveryReport,
} from "@/shared/backend/email/delivery-reports";
import {
  type ReservationAccessDeliveryReport,
  type ReservationDeliveryReportError,
  ReservationFulfillment,
} from "./reservation-fulfillment.service";
import { customerAccessEmailKind } from "./workspace-reservation-email.service";

/** Keeps the webhook's error code and message for each unapplied report. */
const unappliedReportError = (
  report: ReservationAccessDeliveryReport,
  error: ReservationDeliveryReportError
) => {
  const details = { workspaceReservationId: error.workspaceReservationId };
  switch (error.reason) {
    case "delivery_unattached":
      return new DeliveryReportError({
        errorCode: "resend_webhook_delivery_unattached",
        message:
          "Resend webhook referenced the customer delivery before it was attached to a reservation.",
        details,
        cause: error.cause,
      });
    case "reservation_load_failed":
      return new DeliveryReportError({
        errorCode: "resend_webhook_reservation_load_failed",
        message:
          "Resend webhook could not load the reservation for the delivered email.",
        details,
        cause: error.cause,
      });
    case "invoice_processing_failed":
      return new DeliveryReportError({
        errorCode: "resend_webhook_invoice_processing_failed",
        message: "Resend webhook invoice processing failed.",
        details,
        cause: error.cause,
      });
    case "reservation_update_failed":
      return new DeliveryReportError({
        errorCode: "resend_webhook_reservation_update_failed",
        message:
          report.outcome === "delivered"
            ? "Resend webhook could not mark reservation fulfilled."
            : "Resend webhook could not mark reservation fulfillment failed.",
        details,
        cause: error.cause,
      });
  }
};

/**
 * Delivery reports of the customer confirmation settle the reservation's
 * fulfillment; a bounce reports a failed delivery.
 */
export const customerAccessDeliveryReports = deliveryReportHandler(
  customerAccessEmailKind,
  ["email.delivered", "email.failed", "email.bounced"],
  (report) => {
    const accessReport: ReservationAccessDeliveryReport = {
      deliveryId: report.emailId,
      outcome: report.event === "email.delivered" ? "delivered" : "failed",
      occurredAt: report.occurredAt,
      ...Option.match(report.metadata, {
        onNone: () => ({}),
        onSome: (metadata) => ({
          accessEmail: { reservationId: metadata.workspaceReservationId },
        }),
      }),
    };

    return ReservationFulfillment.use((fulfillment) =>
      fulfillment.recordDelivery(accessReport)
    ).pipe(
      Effect.map((outcome) =>
        outcome === "applied"
          ? processedDeliveryReport
          : ignoredDeliveryReport(outcome.ignored)
      ),
      Effect.mapError((error) => unappliedReportError(accessReport, error)),
      Effect.annotateLogs({ resendEmailId: report.emailId })
    );
  }
);
