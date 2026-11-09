import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import {
  NexiWebhookProcessingError,
  NexiWebhookService,
  nexiWebhookRefusal,
} from "@/features/checkout/backend/payment";
import { WorkspaceNexiLayer } from "@/shared/backend/config/nexi.config";
import { defineWebhookRoute } from "@/shared/backend/service-route";

const processWebhookRequest = Effect.fn("processNexiWebhookRequest")(function* (
  request: Request
) {
  const payload = yield* Effect.tryPromise({
    try: () => request.json() as Promise<unknown>,
    catch: (cause) =>
      new NexiWebhookProcessingError({
        errorCode: "nexi_webhook_parse_failed",
        message: "Nexi webhook request body was not valid JSON.",
        cause,
      }),
  });
  yield* Effect.logInfo("Nexi webhook request body parsed");

  const webhooks = yield* NexiWebhookService;
  const result = yield* webhooks.processNotification(payload);
  yield* Effect.annotateLogsScoped({ result });
  yield* Effect.logInfo("Nexi webhook request processed");

  return result;
}, Effect.scoped);

/**
 * POST /api/webhooks/nexi
 *
 * Receives Nexi payment notifications and verifies payment state server-side.
 */
export const POST = defineWebhookRoute(
  {
    operation: "nexiWebhook",
    failureMessage: "Nexi webhook processing failed",
  },
  (request) =>
    processWebhookRequest(request).pipe(
      Effect.tap((result) =>
        Effect.logInfo("Nexi webhook response ready", { result })
      ),
      Effect.mapError(nexiWebhookRefusal),
      Effect.provide(
        NexiWebhookService.Live.pipe(Layer.provide(WorkspaceNexiLayer))
      )
    )
);

/**
 * GET /api/webhooks/nexi
 *
 * Health check endpoint.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/webhooks/nexi",
  });
}
