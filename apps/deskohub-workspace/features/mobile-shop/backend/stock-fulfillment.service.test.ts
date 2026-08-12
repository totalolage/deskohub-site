import { describe, expect, mock, test } from "bun:test";
import {
  DotyposCategoryIdSchema,
  DotyposProductIdSchema,
  DotyposService,
  DotyposWarehouseIdSchema,
  type DotyposWarehouseProduct,
  NetworkError,
} from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { mobileShopPurchaseIdSchema } from "../contracts";
import { MobileShopStockFulfillment } from "./stock-fulfillment.service";

const purchaseId = mobileShopPurchaseIdSchema.make("purchase-1");
const productId = DotyposProductIdSchema.make("water");
const warehouseId = DotyposWarehouseIdSchema.make("warehouse-1");

const runWithDotypos = <A, E>(
  effect: Effect.Effect<A, E, MobileShopStockFulfillment>,
  dotypos: Parameters<typeof Layer.mock<typeof DotyposService>>[1]
) =>
  effect.pipe(
    Effect.provide(
      MobileShopStockFulfillment.Dotypos.pipe(
        Layer.provide(Layer.mock(DotyposService, dotypos))
      )
    ),
    Effect.runPromise
  );

describe("mobile shop Dotypos stock fulfillment", () => {
  test("uses the generated stock deduction service once and returns its warehouse", async () => {
    const deductWarehouseStock = mock(() => Effect.succeed(warehouseId));
    const result = await runWithDotypos(
      Effect.gen(function* () {
        const fulfillment = yield* MobileShopStockFulfillment;
        return yield* fulfillment.fulfillPaidPurchase({
          purchaseId,
          items: [{ productId, quantity: 2 }],
        });
      }),
      { deductWarehouseStock }
    );

    expect(result).toBe(warehouseId);
    expect(deductWarehouseStock).toHaveBeenCalledTimes(1);
    expect(deductWarehouseStock).toHaveBeenCalledWith([
      { productId, quantity: 2 },
    ]);
  });

  test("keeps warehouse quantity backend-only and available to operations", async () => {
    const warehouseProduct: DotyposWarehouseProduct = {
      id: productId,
      _categoryId: DotyposCategoryIdSchema.make("drinks"),
      _warehouseId: warehouseId,
      name: "Water",
      priceWithoutVat: "25.00",
      vat: "0",
      stockQuantityStatus: "4.5",
    };
    const result = await runWithDotypos(
      Effect.gen(function* () {
        const fulfillment = yield* MobileShopStockFulfillment;
        return yield* fulfillment.loadInformativeStock;
      }),
      { getWarehouseProducts: () => Effect.succeed([warehouseProduct]) }
    );

    expect(result).toEqual([warehouseProduct]);
  });

  test("classifies a lost write response as ambiguous and never auto-retryable", async () => {
    const deductWarehouseStock = mock(() =>
      Effect.fail(new NetworkError({ message: "response lost" }))
    );
    const failure = await runWithDotypos(
      Effect.flip(
        Effect.gen(function* () {
          const fulfillment = yield* MobileShopStockFulfillment;
          return yield* fulfillment.fulfillPaidPurchase({
            purchaseId,
            items: [{ productId, quantity: 1 }],
          });
        })
      ),
      { deductWarehouseStock }
    );

    expect(failure).toMatchObject({
      disposition: "ambiguous",
      retryAllowed: false,
    });
    expect(deductWarehouseStock).toHaveBeenCalledTimes(1);
  });
});
