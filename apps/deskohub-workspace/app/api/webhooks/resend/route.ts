import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import {
  DeliveryReportHandlersLive,
  deliveryReportHandlers,
} from "@/shared/backend/email/delivery-report-handlers";
import { ingestDeliveryReport } from "@/shared/backend/email/delivery-reports";
import { ResendWebhookConfig } from "@/shared/backend/email/resend-webhook.config";
import { resendWebhookRefusal } from "@/shared/backend/email/resend-webhook-disposition";
import { defineWebhookRoute } from "@/shared/backend/service-route";

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
        Layer.mergeAll(ResendWebhookConfig.Default, DeliveryReportHandlersLive)
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
