import { StandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { WorkspaceDatabaseLive } from "@/db/database-live.server";
import {
  MobileShopNexiWebhookError,
  MobileShopNexiWebhookService,
} from "@/features/mobile-shop/backend/nexi-webhook.service";
import { MobileShopPaidFulfillmentService } from "@/features/mobile-shop/backend/paid-fulfillment.service";
import { MobileShopPurchaseLifecycleRepository } from "@/features/mobile-shop/backend/purchase-lifecycle.repository";
import { MobileShopReceiptService } from "@/features/mobile-shop/backend/receipt.service";
import { MobileShopStockFulfillment } from "@/features/mobile-shop/backend/stock-fulfillment.service";
import { PostHogEventServiceLive } from "@/shared/backend/analytics/posthog-event.service";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { NexiServiceLive } from "@/shared/backend/config/nexi.config";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

const emailServiceLive = StandaloneEmailServiceLayer.pipe(
  Layer.provide(EmailConfigLayer)
);
const purchaseLifecycleLive = MobileShopPurchaseLifecycleRepository.Live.pipe(
  Layer.provide(WorkspaceDatabaseLive)
);
const receiptLive = MobileShopReceiptService.Live.pipe(
  Layer.provide(
    Layer.mergeAll(
      purchaseLifecycleLive,
      DotyposServiceLive,
      emailServiceLive,
      EmailConfigLayer
    )
  )
);
const stockLive = MobileShopStockFulfillment.Dotypos.pipe(
  Layer.provide(DotyposServiceLive)
);
const fulfillmentLive = MobileShopPaidFulfillmentService.Live.pipe(
  Layer.provide(Layer.mergeAll(purchaseLifecycleLive, receiptLive, stockLive))
);
const webhookLive = MobileShopNexiWebhookService.Live.pipe(
  Layer.provide(
    Layer.mergeAll(
      purchaseLifecycleLive,
      NexiServiceLive,
      fulfillmentLive,
      PostHogEventServiceLive
    )
  )
);

const processWebhook = Effect.fn("processMobileShopNexiWebhook")(function* (
  request: Request
) {
  const payload = yield* Effect.tryPromise({
    try: () => request.json() as Promise<unknown>,
    catch: (cause) =>
      new MobileShopNexiWebhookError({
        code: "mobile_shop_nexi_parse_failed",
        retryProvider: false,
        cause,
      }),
  });
  const webhooks = yield* MobileShopNexiWebhookService;
  return yield* webhooks.processNotification(payload);
}, Effect.scoped);

export const POST = defineWorkspaceRoute(
  {
    operation: "mobileShopNexiWebhook",
    cancellation: "continue-after-disconnect",
  },
  (request) =>
    processWebhook(request).pipe(
      Effect.map((result) =>
        NextResponse.json({
          message: "Webhook received",
          status: result.status,
        })
      ),
      Effect.catchTag("MobileShopNexiWebhookError", (error) =>
        Effect.logError("Mobile shop Nexi webhook processing failed", {
          code: error.code,
          eventId: error.eventId,
          orderId: error.orderId,
          cause: error.cause,
        }).pipe(
          Effect.as(
            NextResponse.json(
              {
                error: "Webhook processing failed",
                code: error.code,
              },
              {
                status: getWebhookFailureStatus(error),
              }
            )
          )
        )
      ),
      Effect.provide(webhookLive),
      Effect.mapError(
        WorkspaceRouteFailure.internal(
          "Mobile shop Nexi webhook processing failed"
        )
      )
    )
);

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/webhooks/nexi/mobile-shop",
  });
}

const getWebhookFailureStatus = (error: MobileShopNexiWebhookError) => {
  if (error.code === "mobile_shop_nexi_parse_failed") return 400;
  return error.retryProvider ? 500 : 202;
};
