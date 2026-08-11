import "server-only";

import { Context, Effect, Layer } from "effect";
import type { MobileShopPurchaseId } from "../contracts";
import {
  MobileShopPurchaseLifecycleRepository,
  toStockItems,
} from "./purchase-lifecycle.repository";
import { MobileShopReceiptService } from "./receipt.service";
import { MobileShopStockFulfillment } from "./stock-fulfillment.service";

export interface IMobileShopPaidFulfillmentService {
  readonly fulfillPaidPurchase: (input: {
    readonly purchaseId: MobileShopPurchaseId;
  }) => Effect.Effect<void>;
}

export class MobileShopPaidFulfillmentService extends Context.Service<
  MobileShopPaidFulfillmentService,
  IMobileShopPaidFulfillmentService
>()("@deskohub-workspace/mobile-shop/MobileShopPaidFulfillmentService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const purchases = yield* MobileShopPurchaseLifecycleRepository;
      const receipts = yield* MobileShopReceiptService;
      const stock = yield* MobileShopStockFulfillment;

      const fulfillStock = Effect.fn(
        "MobileShopPaidFulfillmentService.fulfillStock"
      )(
        function* (input: { readonly purchaseId: MobileShopPurchaseId }) {
          const purchase = yield* purchases.claimStock(input.purchaseId).pipe(
            Effect.tapError((cause) =>
              Effect.logError("Mobile shop stock claim failed", {
                purchaseId: input.purchaseId,
                cause,
              })
            ),
            Effect.orElseSucceed(() => null)
          );
          if (!purchase) return;

          const result = yield* Effect.result(
            stock.fulfillPaidPurchase({
              purchaseId: input.purchaseId,
              items: toStockItems(purchase.items),
            })
          );
          if (result._tag === "Failure") {
            yield* purchases
              .markStockFailed({
                purchaseId: input.purchaseId,
                disposition: result.failure.disposition,
                failureCode:
                  result.failure.disposition === "ambiguous"
                    ? "dotypos_stock_result_ambiguous"
                    : "dotypos_stock_rejected",
              })
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logFatal("Mobile shop stock failure marker failed", {
                    purchaseId: input.purchaseId,
                    cause,
                  })
                ),
                Effect.ignore
              );
            yield* Effect.logError("Mobile shop stock deduction failed", {
              purchaseId: input.purchaseId,
              disposition: result.failure.disposition,
            });
            return;
          }

          yield* purchases
            .markStockSynced({
              purchaseId: input.purchaseId,
              warehouseId: result.success,
              syncedAt: Temporal.Now.instant(),
            })
            .pipe(
              Effect.tapError((cause) =>
                Effect.logFatal(
                  "Mobile shop stock was deducted but its durable marker failed",
                  { purchaseId: input.purchaseId, cause }
                )
              ),
              Effect.ignore
            );
        },
        (effect, input) =>
          effect.pipe(Effect.annotateLogs({ purchaseId: input.purchaseId }))
      );

      return {
        fulfillPaidPurchase: Effect.fn(
          "MobileShopPaidFulfillmentService.fulfillPaidPurchase"
        )(
          (input) =>
            Effect.all(
              [receipts.deliverPaidReceipt(input), fulfillStock(input)],
              { concurrency: "inherit", discard: true }
            ),
          (effect, input) =>
            effect.pipe(
              Effect.annotateLogs({ purchaseId: input.purchaseId }),
              Effect.scoped
            )
        ),
      } satisfies IMobileShopPaidFulfillmentService;
    })
  );

  static Unavailable = Layer.succeed(this, {
    fulfillPaidPurchase: () => Effect.void,
  });
}
