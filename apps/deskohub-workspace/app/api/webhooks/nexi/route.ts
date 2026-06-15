import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import {
  NexiWebhookProcessingError,
  NexiWebhookService,
  NexiWebhookServiceLiveWithDependencies,
} from "@/features/checkout/backend/nexi-webhook.service";
import { NexiServiceLive } from "@/shared/backend/config/nexi.config";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

const NexiWebhookRouteLive = NexiWebhookServiceLiveWithDependencies.pipe(
  Layer.provide(NexiServiceLive)
);

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
    yield* Effect.annotateLogsScoped({
      payload,
      request: {
        headers: Object.fromEntries(request.headers.entries()),
        method: request.method,
        url: request.url,
      },
    });
    yield* Effect.logInfo("Nexi webhook request body parsed");

    const webhooks = yield* NexiWebhookService;
    const result = yield* webhooks.processNotification(payload);
    yield* Effect.annotateLogsScoped({ result });
    yield* Effect.logInfo("Nexi webhook request processed");

    return result;
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
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
      Effect.catchTag(
        "NexiWebhookProcessingError",
        Effect.fn("logNexiWebhookProcessingError")(function* (error) {
          const details = {
            errorCode: error.errorCode,
            eventId: error.eventId,
            orderId: error.orderId,
            cause: error.cause,
          };

          if (
            error.errorCode === "nexi_webhook_fulfillment_failed" ||
            error.errorCode === "nexi_webhook_transition_failed"
          ) {
            yield* Effect.logFatal("Nexi webhook processing failed", details);
          } else {
            yield* Effect.logError("Nexi webhook processing failed", details);
          }

          return yield* Effect.fail(error);
        })
      ),
      Effect.tap((result) =>
        Effect.logInfo("Nexi webhook response ready", { result })
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
      Effect.catchAll((cause) =>
        Effect.logError("Nexi webhook route failed", { cause }).pipe(
          Effect.as(
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
