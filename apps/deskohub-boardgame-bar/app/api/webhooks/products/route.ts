import { Effect, Schema } from "effect";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { env } from "@/env";
import {
  validateWebhookUUID,
  WebhookValidationError,
} from "@/shared/backend/utils/webhook";
import { dotyposTags } from "@/shared/utils/cache-tags";

/**
 * Dotypos Product Webhook Payload Schema
 *
 * Using Effect Schema for robust validation and type safety
 *
 * Product types: 0 = SALE, 1 = RECIPE, 2 = HALF_PRODUCT, 3 = MENU
 * Stock overdraft options: ALLOW, WARN, DENY
 * Units: Piece, Kilogram, Liter, Meter, Hour
 */
const DotyposProductPayloadItem = Schema.Struct({
  // Identity & Classification
  productid: Schema.Number,
  categoryid: Schema.Number,
  externalid: Schema.NullOr(Schema.String),
  type: Schema.Number,

  // Basic Product Information
  name: Schema.String,
  canonicalname: Schema.String,
  numcanonicalname: Schema.String,
  alternativename: Schema.String,
  subtitle: Schema.String,
  description: Schema.String,

  // Translated content
  translatedname: Schema.NullOr(
    Schema.Record({ key: Schema.String, value: Schema.String })
  ),
  translateddescription: Schema.NullOr(
    Schema.Record({ key: Schema.String, value: Schema.String })
  ),

  // Pricing Information
  pricewithvat: Schema.Number,
  pricewithoutvat: Schema.Number,
  pricewithvatb: Schema.NullOr(Schema.Number),
  pricewithvatc: Schema.NullOr(Schema.Number),
  pricewithvatd: Schema.NullOr(Schema.Number),
  pricewithvate: Schema.NullOr(Schema.Number),
  priceinpoints: Schema.NullOr(Schema.Number),
  discountpercent: Schema.Number,
  discountpermitted: Schema.Number,
  requirespriceentry: Schema.Number,

  // Stock Information
  stockdeduct: Schema.Number,
  stockoverdraft: Schema.Union(
    Schema.Literal("ALLOW"),
    Schema.Literal("WARN"),
    Schema.Literal("DENY")
  ),
  stockquantity: Schema.NullOr(Schema.Number),

  // Packaging Information
  packaging: Schema.Number,
  packagingmeasurement: Schema.Number,
  packagingpricewithvat: Schema.NullOr(Schema.Number),

  // Units & Measurements
  units: Schema.String,
  unitsmeasurement: Schema.String,

  // Display & Presentation
  display: Schema.Number,
  hexcolor: Schema.String,
  imageurl: Schema.NullOr(Schema.String),
  uri: Schema.NullOr(Schema.String),
  sortorder: Schema.Number,

  // Additional Information
  allergens: Schema.String,
  features: Schema.String,
  tagslist: Schema.String,
  noteslist: Schema.String,

  // Financial & Tax Information
  vat: Schema.Number,
  eetsubjectid: Schema.NullOr(Schema.Number),
  currency: Schema.NullOr(Schema.String),
  margin: Schema.String,
  marginmin: Schema.NullOr(Schema.Number),

  // Supplier Information
  supplier_id: Schema.NullOr(Schema.Number),
  supplierproductcode: Schema.NullOr(Schema.String),

  // Product Codes
  ean: Schema.String,
  plu: Schema.String,

  // Restaurant/Hospitality Specific
  defaultcourseid: Schema.NullOr(Schema.Number),
  preparationduration: Schema.NullOr(Schema.Number),
  packageitem: Schema.NullOr(Schema.Number),
  mincustomerage: Schema.NullOr(Schema.Number),

  // Loyalty & Points
  points: Schema.Number,
  onsale: Schema.Number,

  // Reference Fields
  group_id: Schema.NullOr(Schema.Number),
  dnids: Schema.NullOr(Schema.String),

  // System Fields
  created: Schema.Number,
  versiondate: Schema.Number,
  deleted: Schema.Number,
  modifiedby: Schema.String,
  bitflags: Schema.Number,
});

// The webhook sends an array of product items
const DotyposProductPayload = Schema.NonEmptyArray(DotyposProductPayloadItem);

/**
 * Determine the operation type based on product state
 */
type ProductOperation = "created" | "updated" | "deleted";

const getProductOperation = (
  product: Schema.Schema.Type<typeof DotyposProductPayloadItem>
): ProductOperation => {
  if (product.deleted === 1) return "deleted";
  // Check if created and versiondate are very close (within 1 second)
  if (Math.abs(product.created - product.versiondate) < 1000) return "created";
  return "updated";
};

/**
 * Process the products webhook payload
 */
const processWebhook = Effect.fn("processWebhook")(
  function* (payload: unknown) {
    yield* Effect.log("Processing webhook");

    // Validate and parse the payload
    const validatedPayload = yield* Schema.decodeUnknown(DotyposProductPayload)(
      payload
    ).pipe(
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
      operation: getProductOperation(product),
      name: product.name,
      categoryId: product.categoryid,
      deleted: product.deleted === 1,
    }));

    // Log the operations for monitoring
    yield* Effect.logInfo("Processing product webhook", {
      productCount: operations.length,
      operations: operations.map((op) => ({
        id: op.productId,
        operation: op.operation,
        name: op.name,
      })),
    });

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
      revalidateTag(tag, "max");
    }

    yield* Effect.logInfo("Product caches invalidated", {
      tags: tagsToInvalidate,
      categoryCount: categoryIds.size,
    });

    return {
      success: true as const,
      message: "Product webhook processed successfully",
      data: {
        productCount: operations.length,
        operations,
        invalidatedTags: tagsToInvalidate,
      },
    };
  },
  (effect, input) =>
    effect.pipe(
      Effect.annotateLogs({
        operation: "processWebhook",
        input,
      })
    )
);

/**
 * POST /api/webhooks/products
 *
 * Receives product update webhooks from Dotypos
 * Processes create, update, and delete operations for products
 *
 * Security: Uses the same UUID secret as the reservation webhook
 * NOTE: Returns 200 status even for some errors to prevent Dotypos from retrying
 */
export async function POST(request: Request): Promise<NextResponse> {
  const program = Effect.gen(function* () {
    yield* Effect.log("Webhook invoked");

    // Validate webhook security using UUID
    const url = new URL(request.url);
    yield* validateWebhookUUID(url, {
      webhookSecret: env.DOTYPOS_WEBHOOK_SECRET,
      nodeEnv: env.NEXT_PUBLIC_NODE_ENV,
      vercelEnv: env.NEXT_PUBLIC_VERCEL_ENV,
    });

    // Parse request body
    const payload = yield* Effect.tryPromise({
      try: () => request.json(),
      catch: () =>
        new WebhookValidationError({
          message: "Failed to parse request body",
        }),
    });

    // Log raw payload for debugging schema mismatches
    yield* Effect.logInfo("Received product webhook payload", {
      payload: JSON.stringify(payload, null, 2),
    });

    // Process the webhook
    const result = yield* processWebhook(payload);

    return result;
  }).pipe(
    Effect.tapError(
      Effect.fn(function* (error) {
        yield* Effect.logError(error);
      })
    ),
    Effect.annotateLogs({
      method: "POST",
      operation: "webhook",
      request,
    }),
    Effect.catchTags({
      WebhookAuthError: (error) =>
        Effect.succeed(
          NextResponse.json(
            { error: "Unauthorized", message: error.message },
            { status: 401 }
          )
        ),
      WebhookValidationError: (error) =>
        Effect.succeed(
          NextResponse.json(
            {
              error: "Invalid payload",
              message: error.message,
              issues: error.issues,
              payload: error.payload,
            },
            { status: 400 }
          )
        ),
    }),
    Effect.orElseSucceed(() =>
      // return 200 to prevent Dotypos from retrying
      Effect.succeed({
        status: 200,
        body: {
          success: true,
          error: "Internal processing error (logged)",
        },
      })
    )
  );

  try {
    const result = await Effect.runPromise(program);

    // Handle different result types
    if ("status" in result) {
      return NextResponse.json(result.body, { status: result.status });
    }

    return NextResponse.json(result);
  } catch (_error) {
    // This should rarely happen as we catch all errors in the Effect pipeline
    // IMPORTANT: Return 200 to prevent Dotypos from retrying
    return NextResponse.json(
      { success: true, error: "Internal processing error (logged)" },
      { status: 200 }
    );
  }
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
