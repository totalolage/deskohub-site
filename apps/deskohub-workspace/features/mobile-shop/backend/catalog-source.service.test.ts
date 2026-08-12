import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import {
  MobileShopCatalogPolicy,
  MobileShopCatalogSource,
} from "./catalog-source.service";

describe("mobile shop catalog source", () => {
  test("loads the complete Dotypos category and product catalog", async () => {
    const getCategories = mock(() => Effect.succeed([]));
    const getProducts = mock(() => Effect.succeed([]));
    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const source = yield* MobileShopCatalogSource;
        return yield* source.loadAll;
      }).pipe(
        Effect.provide(
          MobileShopCatalogSource.Dotypos.pipe(
            Layer.provide(
              Layer.mock(DotyposService, { getCategories, getProducts })
            )
          )
        )
      )
    );

    expect(snapshot).toEqual({ categories: [], products: [] });
    expect(getCategories).toHaveBeenCalledTimes(1);
    expect(getProducts).toHaveBeenCalledTimes(1);
    expect(getProducts).toHaveBeenCalledWith({ includeDeleted: true });
  });
});

describe("mobile shop catalog policy", () => {
  test("pins Desktechub's verified non-VAT Dotypos price mapping", async () => {
    const policy = await Effect.runPromise(
      Effect.gen(function* () {
        const catalogPolicy = yield* MobileShopCatalogPolicy;
        return yield* catalogPolicy.current;
      }).pipe(Effect.provide(MobileShopCatalogPolicy.DesktechubNonVat))
    );

    expect(policy).toEqual({
      finalPriceField: "priceWithoutVat",
      taxRegime: {
        kind: "not-vat-payer",
        version: "desktechub-non-vat-2026-08",
        effectiveFrom: "2026-08-11",
      },
    });
  });
});
