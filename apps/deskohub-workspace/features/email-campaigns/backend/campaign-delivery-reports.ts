import { Effect, Option } from "effect";
import {
  DeliveryReportError,
  deliveryReportHandlerOwningIgnores,
  ignoredDeliveryReport,
} from "@/shared/backend/email/delivery-reports";
import { campaignEmailKind } from "../campaign-email-message";
import { CampaignDeliveryStatusService } from "./campaign-delivery-status.service";

/**
 * Delivery reports of campaign emails record the frozen recipient's
 * delivery status; no reservation is involved. Every report of the kind
 * with an email ID reaches the status record, which ignores events that
 * change no status.
 */
export const campaignDeliveryReports = deliveryReportHandlerOwningIgnores(
  campaignEmailKind,
  ["email.delivered", "email.bounced", "email.complained"],
  "resendWebhook.processCampaignEvent",
  (report) =>
    Option.match(report.emailId, {
      onNone: () =>
        Effect.succeed(ignoredDeliveryReport("campaign_email_id_missing")),
      onSome: (providerMessageId) =>
        Effect.service(CampaignDeliveryStatusService)
          .pipe(
            Effect.flatMap((deliveryStatus) =>
              deliveryStatus.record({
                type: report.event,
                providerMessageId,
                recipient: report.metadata,
                occurredAt: report.occurredAt,
              })
            )
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new DeliveryReportError({
                  errorCode: "resend_webhook_campaign_update_failed",
                  message:
                    "Resend webhook could not record the campaign delivery status.",
                  cause,
                })
            )
          ),
    })
);
