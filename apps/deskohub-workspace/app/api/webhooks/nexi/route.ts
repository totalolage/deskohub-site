import { NexiApi, NexiService } from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import {
  NexiWebhookProcessingError,
  NexiWebhookService,
  NexiWebhookServiceLiveWithDependencies,
} from "@/features/checkout/backend/nexi-webhook.service";
import { NexiRuntimeConfigLive } from "@/shared/backend/config/nexi.config";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

const NexiWebhookRouteLive = NexiWebhookServiceLiveWithDependencies.pipe(
  Layer.provide(
    Layer.provide(
      NexiService.Default,
      Layer.provide(NexiApi.Default, NexiRuntimeConfigLive)
    )
  )
);

const isNexiWebhookProcessingError = (
  error: unknown
): error is NexiWebhookProcessingError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "NexiWebhookProcessingError";

const processWebhookRequest = Effect.fn("processNexiWebhookRequest")(
  function* (request: Request) {
    const payload = yield* Effect.tryPromise({
      try: () => request.json() as Promise<unknown>,
      catch: (cause) =>
        new NexiWebhookProcessingError({
          errorCode: "nexi_webhook_parse_failed",
          message: "Nexi webhook request body was not valid JSON.",
          cause,
        }),
    });

    const webhooks = yield* NexiWebhookService;
    return yield* webhooks.processNotification(payload);
  },
  (effect) =>
    effect.pipe(
      Effect.annotateLogs({
        method: "POST",
        operation: "nexiWebhook",
      })
    )
);

/**
 * POST /api/webhooks/nexi
 *
 * Receives Nexi payment notifications and verifies payment state server-side.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return runWorkspaceEffect(
    processWebhookRequest(request).pipe(
      Effect.provide(NexiWebhookRouteLive),
      Effect.tapError(
        Effect.fn("logNexiWebhookError")(function* (error) {
          if (isNexiWebhookProcessingError(error)) {
            yield* Effect.logError("Nexi webhook processing failed", {
              errorCode: error.errorCode,
              eventId: error.eventId,
              orderId: error.orderId,
            });
            return;
          }

          yield* Effect.logError("Nexi webhook route failed");
        })
      ),
      Effect.map((result) =>
        NextResponse.json({
          message: "Webhook received",
          status: result.status,
        })
      ),
      Effect.catchTag("NexiWebhookProcessingError", (error) =>
        Effect.succeed(
          NextResponse.json(
            {
              error: "Webhook processing failed",
              code: error.errorCode,
            },
            {
              status:
                error.errorCode === "nexi_webhook_parse_failed" ? 400 : 202,
            }
          )
        )
      ),
      Effect.catchAll(() =>
        Effect.succeed(
          NextResponse.json(
            {
              error: "Webhook processing failed",
              code: "nexi_webhook_internal_error",
            },
            { status: 202 }
          )
        )
      )
    )
  );
}

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
