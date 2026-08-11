import {
  type DeductDotyposWarehouseStockItem,
  DotyposService,
  type DotyposWarehouseId,
  type DotyposWarehouseProduct,
  ValidationError,
} from "@deskohub/dotypos";
import { Context, Data, Effect, Layer } from "effect";
import type { MobileShopPurchaseId } from "../contracts";
import { MobileShopFailure } from "../errors";

export class MobileShopStockFulfillmentFailure extends Data.TaggedError(
  "MobileShopStockFulfillmentFailure"
)<{
  readonly disposition: "ambiguous" | "definitive";
  readonly retryAllowed: boolean;
  readonly cause: unknown;
}> {}

export interface IMobileShopStockFulfillment {
  /** Backend-only stock view. It must never be projected into customer DTOs. */
  readonly loadInformativeStock: Effect.Effect<
    readonly DotyposWarehouseProduct[],
    MobileShopFailure
  >;
  readonly fulfillPaidPurchase: (input: {
    readonly purchaseId: MobileShopPurchaseId;
    readonly items: readonly DeductDotyposWarehouseStockItem[];
  }) => Effect.Effect<DotyposWarehouseId, MobileShopStockFulfillmentFailure>;
}

/**
 * The live adapter deliberately performs one provider call and never retries a
 * write whose response was lost. Without a provider idempotency key or verified
 * stock-log correlation, any provider/network failure is ambiguous by default.
 */
export class MobileShopStockFulfillment extends Context.Service<
  MobileShopStockFulfillment,
  IMobileShopStockFulfillment
>()("@deskohub-workspace/mobile-shop/MobileShopStockFulfillment") {
  static Dotypos = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;

      return {
        loadInformativeStock: dotypos
          .getWarehouseProducts()
          .pipe(
            Effect.mapError(
              (cause) =>
                new MobileShopFailure({ code: "service_unavailable", cause })
            )
          ),
        fulfillPaidPurchase: Effect.fn(
          "MobileShopStockFulfillment.fulfillPaidPurchase"
        )(
          (input) =>
            dotypos
              .deductWarehouseStock(input.items)
              .pipe(Effect.mapError(classifyStockFulfillmentFailure)),
          (effect, input) =>
            effect.pipe(Effect.annotateLogs({ purchaseId: input.purchaseId }))
        ),
      } satisfies IMobileShopStockFulfillment;
    })
  );

  static Unavailable = Layer.succeed(this, {
    loadInformativeStock: Effect.fail(
      MobileShopFailure.integrationUnavailable(
        "The Dotypos warehouse adapter has not been installed."
      )
    ),
    fulfillPaidPurchase: () =>
      Effect.fail(
        new MobileShopStockFulfillmentFailure({
          disposition: "definitive",
          retryAllowed: false,
          cause: "The Dotypos warehouse adapter has not been installed.",
        })
      ),
  });
}

const classifyStockFulfillmentFailure = (cause: unknown) =>
  new MobileShopStockFulfillmentFailure({
    disposition: cause instanceof ValidationError ? "definitive" : "ambiguous",
    retryAllowed: false,
    cause,
  });
