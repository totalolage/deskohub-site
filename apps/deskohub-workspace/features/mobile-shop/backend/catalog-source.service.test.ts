import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { MobileShopCatalogPolicy } from "./catalog-source.service";

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
