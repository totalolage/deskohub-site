import { Effect } from "effect";
import { NextResponse } from "next/server";
import { DotyposServiceLive, getMenuItems } from "@/features/dotypos";
import { DotyposClient } from "@/features/dotypos/backend/service";

export async function GET() {
  try {
    const result = await Effect.runPromise(
      getMenuItems().pipe(
        Effect.provide(DotyposServiceLive),
        Effect.tapError((error) =>
          Effect.logError("Failed to fetch menu data", error)
        )
      )
    );

    // Find the "Test localization" product
    const testProduct = result.items.find(
      (item) =>
        item.name.toLowerCase().includes("test") &&
        item.name.toLowerCase().includes("localization")
    );

    // Also check raw product fields
    const rawProductResponse = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* DotyposClient;
        const products = yield* client.getProducts({ includeDeleted: false });

        // Find test product in raw response
        const rawTest = products.find(
          (p) =>
            p.name?.toLowerCase().includes("test") &&
            p.name.toLowerCase().includes("localization")
        );

        // Find products with translations
        const productsWithTranslations = products.filter(
          (p) =>
            (p.translatedDescription &&
              Object.keys(p.translatedDescription).length > 0) ||
            (p.translatedName && Object.keys(p.translatedName).length > 0)
        );

        // Log all products to see what we have
        const allProductNames = products.map((p) => p.name);

        return {
          products,
          testProduct: rawTest,
          allProductNames,
          productsCount: products.length,
          productsWithTranslations: productsWithTranslations.map((p) => ({
            name: p.name,
            translatedName: p.translatedName,
            translatedDescription: p.translatedDescription,
          })),
        };
      }).pipe(Effect.provide(DotyposServiceLive))
    );

    return NextResponse.json({
      processedTestProduct: testProduct || "Not found in processed items",
      rawTestProduct:
        rawProductResponse.testProduct || "Not found in raw products",
      firstRawProduct: rawProductResponse.products[0],
      allProductNames: rawProductResponse.allProductNames,
      totalProducts: rawProductResponse.productsCount,
      productsWithTranslations: rawProductResponse.productsWithTranslations,
      availableProducts: result.items
        .map((item) => ({
          name: item.name,
          description: item.description,
        }))
        .slice(0, 10),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch menu data", details: String(error) },
      { status: 500 }
    );
  }
}
