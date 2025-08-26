import { Effect } from "effect";
import { DotyposService, DotyposServiceLive } from "@/features/dotypos";

async function testProducts() {
  const program = Effect.gen(function* () {
    const service = yield* DotyposService;

    // Get products
    const products = yield* service.getProducts({
      includeDeleted: false,
    });

    // Find the "Test localization" product
    const testProduct = products.find(
      (p) =>
        p.name.toLowerCase().includes("test") &&
        p.name.toLowerCase().includes("localization")
    );

    if (testProduct) {
    } else {
      products.forEach((_p) => {});
    }

    // Also log the raw first product to see all fields
    if (products.length > 0) {
    }

    return products;
  });

  try {
    await Effect.runPromise(program.pipe(Effect.provide(DotyposServiceLive)));
  } catch (error) {
    console.error("Error fetching products:", error);
  }
}

testProducts();
