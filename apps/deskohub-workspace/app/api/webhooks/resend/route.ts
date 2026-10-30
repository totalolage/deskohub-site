import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import {
  customerAccessDeliveryReports,
  ReservationFulfillment,
} from "@/features/checkout/backend/fulfillment";
import { campaignDeliveryReports } from "@/features/email-campaigns/backend/campaign-delivery-reports";
import { CampaignDeliveryStatusService } from "@/features/email-campaigns/backend/campaign-delivery-status.service";
import {
  type DeliveryReportHandler,
  ingestDeliveryReport,
} from "@/shared/backend/email/delivery-reports";
import { ResendWebhookConfig } from "@/shared/backend/email/resend-webhook.config";
import { resendWebhookRefusal } from "@/shared/backend/email/resend-webhook-disposition";
import { defineWebhookRoute } from "@/shared/backend/service-route";

const deliveryReportHandlers: readonly DeliveryReportHandler<
  ReservationFulfillment | CampaignDeliveryStatusService
>[] = [customerAccessDeliveryReports, campaignDeliveryReports];

/**
 * POST /api/webhooks/resend
 *
 * Receives Resend delivery reports for the customer confirmation and for
 * campaign emails.
 */
export const POST = defineWebhookRoute(
  {
    operation: "resendWebhook",
    failureMessage: "Resend webhook processing failed",
  },
  (request) =>
    ingestDeliveryReport(request, deliveryReportHandlers).pipe(
      Effect.tap((result) =>
        Effect.logInfo("Resend webhook response ready", { result })
      ),
      Effect.mapError(resendWebhookRefusal),
      Effect.provide(
        Layer.mergeAll(
          ResendWebhookConfig.Default,
          ReservationFulfillment.Live,
          CampaignDeliveryStatusService.Live
        )
      )
    )
);

/**
 * GET /api/webhooks/resend
 *
 * Health check endpoint.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/webhooks/resend",
  });
}
