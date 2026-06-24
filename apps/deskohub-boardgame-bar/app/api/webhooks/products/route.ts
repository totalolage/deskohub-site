import { Data, Effect, Schema } from "effect";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { dotyposTags } from "@/shared/utils/cache-tags";
import { isDev } from "@/shared/utils/environment";

class WebhookAuthError extends Data.TaggedError("WebhookAuthError")<{
  readonly message: string;
}> {}

class WebhookValidationError extends Data.TaggedError(
  "WebhookValidationError"
)<{
  readonly message: string;
  readonly issues?: unknown;
}> {}

const validateWebhookUUID = (url: URL) =>
  Effect.gen(function* () {
    if (isDev()) return;

    const providedSecret = url.searchParams.get("secret");

    if (!providedSecret) {
      yield* Effect.fail(
        new WebhookAuthError({ message: "Missing webhook secret" })
      );
    }

    if (!env.DOTYPOS_WEBHOOK_SECRET) {
      yield* Effect.fail(
        new WebhookAuthError({ message: "Webhook secret is not configured" })
      );
    }

    if (providedSecret !== env.DOTYPOS_WEBHOOK_SECRET) {
      yield* Effect.fail(
        new WebhookAuthError({ message: "Invalid webhook secret" })
      );
    }
  });

const DotyposProductPayloadItem = Schema.Struct({
  productid: Schema.Number,
  categoryid: Schema.Number,
  name: Schema.String,
  created: Schema.Number,
  versiondate: Schema.Number,
  deleted: Schema.Number,
});

const DotyposProductPayload = Schema.NonEmptyArray(DotyposProductPayloadItem);

/**
 * POST /api/webhooks/products
 *
 * Receives product update webhooks from Dotypos
 * Processes create, update, and delete operations for products
 *
 * Security: Uses the same UUID secret as the reservation webhook
 */
export async function POST(request: Request): Promise<NextResponse> {
  const program = Effect.gen(function* () {
    yield* Effect.logInfo("Product webhook invoked");

    // Validate webhook security using UUID
    const url = new URL(request.url);
    yield* validateWebhookUUID(url);

    // Parse request body
    const payload = yield* Effect.tryPromise({
      try: () => request.json(),
      catch: () =>
        new WebhookValidationError({
          message: "Failed to parse request body",
        }),
    });

    // Validate and parse the payload
    const validatedPayload = yield* Schema.decodeUnknownEffect(
      DotyposProductPayload
    )(payload).pipe(
      Effect.mapError(
        (error) =>
          new WebhookValidationError({
            message: "Invalid product payload format",
            issues: error.message,
          })
      )
    );

    // Process each product in the payload
    const operations = validatedPayload.map((product) => ({
      productId: product.productid,
      operation:
        product.deleted === 1
          ? "deleted"
          : Math.abs(product.created - product.versiondate) < 1000
            ? "created"
            : "updated",
      name: product.name,
      categoryId: product.categoryid,
      deleted: product.deleted === 1,
    }));

    // Collect unique category IDs from affected products
    const categoryIds = new Set(
      operations.map((op) => String(op.categoryId)).filter(Boolean)
    );

    // Invalidate all relevant caches
    const tagsToInvalidate = [
      dotyposTags.menu.all(),
      ...Array.from(categoryIds).map((id) => dotyposTags.menu.byCategory(id)),
      ...operations.map((op) =>
        dotyposTags.menu.byProduct(String(op.productId))
      ),
    ];

    // Invalidate cache tags
    for (const tag of tagsToInvalidate) {
      yield* Effect.try({
        try: () => revalidateTag(tag, "max"),
        catch: (cause) => cause,
      });
    }

    yield* Effect.logInfo("Product webhook processed", {
      productCount: operations.length,
      categoryCount: categoryIds.size,
    });

    const result = {
      success: true as const,
      message: "Product webhook processed successfully",
      data: {
        productCount: operations.length,
        operations,
        invalidatedTags: tagsToInvalidate,
      },
    };

    return NextResponse.json(result);
  }).pipe(
    Effect.tapError(
      Effect.fn(function* (error) {
        yield* Effect.logError(error);
      })
    ),
    Effect.annotateLogs({
      method: "POST",
      operation: "webhook",
    }),
    Effect.scoped,
    Effect.catchTags({
      WebhookAuthError: (error: { readonly message: string }) =>
        Effect.succeed(
          NextResponse.json(
            { error: "Unauthorized", message: error.message },
            { status: 401 }
          )
        ),
      WebhookValidationError: (error: {
        readonly message: string;
        readonly issues?: unknown;
      }) =>
        Effect.succeed(
          NextResponse.json(
            {
              error: "Invalid payload",
              message: error.message,
              issues: error.issues ?? null,
            },
            { status: 400 }
          )
        ),
    }),
    Effect.catch(() =>
      Effect.succeed(
        NextResponse.json({
          success: false,
          error: "Internal processing error",
        })
      )
    )
  );

  return Effect.runPromise(program);
}

/**
 * GET /api/webhooks/products
 *
 * Health check endpoint for testing
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/webhooks/products",
    accepts: "POST",
    description: "Dotypos product update webhook",
    security: "enabled (query param: ?secret=UUID)",
    validation: "Effect Schema validation enabled",
    operations: ["create", "update", "delete"],
  });
}
