import { Effect } from "effect";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { DotyposMenuCacheTags } from "@/features/dotypos/utils/cache-tags";
import {
  handleWebhookError,
  validateWebhookUUID,
} from "@/shared/backend/utils/webhook";

/**
 * Process the products webhook
 * Simply invalidates all product caches without parsing the payload
 */
const processWebhook = () =>
  Effect.gen(function* () {
    // Create cache tags for all products
    const cacheTags = new DotyposMenuCacheTags();

    // Invalidate all product caches
    yield* Effect.sync(() => {
      revalidateTag(cacheTags.all);
    });

    yield* Effect.logInfo("Product caches invalidated", {
      tag: cacheTags.all,
    });

    return {
      success: true as const,
      message: "Product caches invalidated",
      invalidatedTag: cacheTags.all,
    };
  });

/**
 * Dotypos Products Webhook Handler
 *
 * This webhook is triggered when products are updated in Dotypos.
 * It simply invalidates all product-related caches without processing
 * the payload details.
 *
 * Security: Uses the same UUID secret as the reservation webhook
 */
export async function POST(request: Request) {
  const url = new URL(request.url);

  // Run the Effect pipeline
  const result = await Effect.runPromise(
    handleWebhookError(
      Effect.gen(function* () {
        // Validate webhook security using UUID
        yield* validateWebhookUUID(url);

        // Process webhook (just invalidate caches)
        const response = yield* processWebhook();

        return response;
      })
    ).pipe(
      // Log the entire pipeline
      Effect.tap((result) =>
        result.success
          ? Effect.logInfo("Products webhook processed successfully", result)
          : Effect.logDebug("Products webhook auth/validation failed", result)
      ),
      Effect.withSpan("webhooks.products.POST")
    )
  );

  // Return appropriate response
  if ("success" in result && !result.success) {
    const status =
      result.error === "Unauthorized"
        ? 401
        : result.error === "Bad Request"
          ? 400
          : 500;
    return NextResponse.json(
      {
        error: result.error,
        message: result.message,
        ...("issues" in result && result.issues
          ? { issues: result.issues }
          : {}),
      },
      { status }
    );
  }

  return NextResponse.json(result);
}
