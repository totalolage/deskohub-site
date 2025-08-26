import * as Schema from "@effect/schema/Schema";
import { v2 as cloudinary } from "cloudinary";
import { Context, Effect, Layer, pipe } from "effect";
import { env } from "@/env";
import type { CnfExpression } from "@/shared/utils/normalize-tag-expression";
import type { CloudinaryTag } from "../types/cloudinary-tag";
import { cnfToCloudinaryExpression } from "../utils/cnf-to-cloudinary-tag";

// ============================================================================
// Schemas
// ============================================================================

export const CloudinaryAssetSchema = Schema.Struct({
  public_id: Schema.String,
  secure_url: Schema.String,
  url: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  format: Schema.String,
  resource_type: Schema.String,
  created_at: Schema.String,
  folder: Schema.optional(Schema.String), // Folder is returned by default
  tags: Schema.optional(Schema.Array(Schema.String)),
  context: Schema.optional(
    Schema.Struct({
      custom: Schema.optional(
        Schema.Struct({
          alt: Schema.optional(Schema.String),
          caption: Schema.optional(Schema.String),
        })
      ),
    })
  ),
});

export type CloudinaryAsset = Schema.Schema.Type<typeof CloudinaryAssetSchema>;

export const SearchOptionsSchema = Schema.Struct({
  maxResults: Schema.optional(Schema.Number.pipe(Schema.positive())),
  sortBy: Schema.optional(
    Schema.Literal("created_at", "updated_at", "public_id")
  ),
  sortDirection: Schema.optional(Schema.Literal("asc", "desc")),
});

export type SearchOptions = Schema.Schema.Type<typeof SearchOptionsSchema>;

// ============================================================================
// Errors
// ============================================================================

export class CloudinaryConfigError extends Schema.TaggedError<CloudinaryConfigError>()(
  "CloudinaryConfigError",
  {
    message: Schema.String,
  }
) {}

export class CloudinarySearchError extends Schema.TaggedError<CloudinarySearchError>()(
  "CloudinarySearchError",
  {
    message: Schema.String,
    expression: Schema.String,
  }
) {}

// ============================================================================
// Service Interface
// ============================================================================

export interface CloudinaryService {
  readonly searchByTag: (
    tag: string,
    options?: SearchOptions
  ) => Effect.Effect<readonly CloudinaryAsset[], CloudinarySearchError>;

  readonly searchByFolder: (
    folder: string,
    options?: SearchOptions
  ) => Effect.Effect<readonly CloudinaryAsset[], CloudinarySearchError>;

  readonly searchAll: (
    options?: SearchOptions
  ) => Effect.Effect<readonly CloudinaryAsset[], CloudinarySearchError>;

  readonly searchByExpression: (
    expression: string,
    options?: SearchOptions
  ) => Effect.Effect<readonly CloudinaryAsset[], CloudinarySearchError>;

  readonly searchWithTags: (
    tags: CnfExpression<CloudinaryTag>,
    options?: SearchOptions
  ) => Effect.Effect<readonly CloudinaryAsset[], CloudinarySearchError>;
}

export const CloudinaryService = Context.GenericTag<CloudinaryService>(
  "@app/CloudinaryService"
);

// ============================================================================
// Live Implementation
// ============================================================================

const makeCloudinaryService = Effect.gen(function* () {
  // Configure Cloudinary
  yield* Effect.sync(() => {
    cloudinary.config({
      cloud_name: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
    });
  });

  yield* Effect.log("Cloudinary service initialized", {
    url: `cloudinary://${env.CLOUDINARY_API_KEY}:${"*".repeat(env.CLOUDINARY_API_SECRET.length)}@${env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}`,
  });

  const buildSearchExpression = (
    baseExpression: string,
    options?: SearchOptions
  ) => {
    let search = cloudinary.search.expression(baseExpression);

    // Add fields we want to retrieve
    search = search.with_field("tags").with_field("context");

    // Apply options
    if (options?.maxResults) {
      search = search.max_results(options.maxResults);
    } else {
      search = search.max_results(100); // Default
    }

    if (options?.sortBy && options?.sortDirection) {
      search = search.sort_by(options.sortBy, options.sortDirection);
    } else if (options?.sortBy) {
      search = search.sort_by(options.sortBy, "desc");
    } else {
      search = search.sort_by("created_at", "desc"); // Default
    }

    return search;
  };

  const executeSearch = (
    expression: string,
    options?: SearchOptions
  ): Effect.Effect<readonly CloudinaryAsset[], CloudinarySearchError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          const search = buildSearchExpression(expression, options);
          const result = await search.execute();
          return result.resources as CloudinaryAsset[];
        },
        catch: (error) => {
          const errorMessage =
            error instanceof Error
              ? error.message
              : typeof error === "object" && error !== null
                ? JSON.stringify(error)
                : String(error);

          return new CloudinarySearchError({
            message: errorMessage,
            expression,
          });
        },
      }),
      Effect.tap((results) =>
        Effect.log(`Search completed`, {
          expression,
          resultCount: results.length,
          options,
        })
      ),
      Effect.tapError((error) =>
        Effect.logError("Search failed", {
          expression,
          errorMessage: error.message,
          errorDetails: JSON.stringify(error, null, 2),
        })
      )
    );

  const searchByTag: CloudinaryService["searchByTag"] = (tag, options) =>
    pipe(
      Effect.log(`Searching by tag: ${tag}`),
      Effect.flatMap(() => {
        const expression = `tags=${tag} AND resource_type:image`;
        return executeSearch(expression, options);
      }),
      Effect.tap((results) =>
        Effect.log(`Found ${results.length} images with tag: ${tag}`)
      )
    );

  const searchByFolder: CloudinaryService["searchByFolder"] = (
    folder,
    options
  ) =>
    pipe(
      Effect.log(`Searching by folder: ${folder}`),
      Effect.flatMap(() => {
        // Try different folder formats
        const expressions = [
          `folder=${folder}`, // Without quotes (standard format)
          `folder:${folder}`, // Colon syntax (alternative)
        ];

        return Effect.gen(function* () {
          for (const expr of expressions) {
            yield* Effect.log(`Trying folder expression: ${expr}`);
            const results = yield* executeSearch(
              `${expr} AND resource_type:image`,
              options
            );
            if (results.length > 0) {
              yield* Effect.log(
                `Found ${results.length} images in folder with expression: ${expr}`
              );
              return results;
            }
          }
          yield* Effect.log(
            `No images found for any variation of folder: ${folder}`
          );
          return [];
        });
      })
    );

  const searchAll: CloudinaryService["searchAll"] = (options) =>
    pipe(
      Effect.log("Searching all images"),
      Effect.flatMap(() => executeSearch("resource_type:image", options)),
      Effect.tap((results) =>
        Effect.log(`Found ${results.length} total images`)
      )
    );

  const searchByExpression: CloudinaryService["searchByExpression"] = (
    expression,
    options
  ) =>
    pipe(
      Effect.log(`Searching by custom expression: ${expression}`),
      Effect.flatMap(() => executeSearch(expression, options))
    );

  const searchWithTags: CloudinaryService["searchWithTags"] = (tags, options) =>
    Effect.gen(function* () {
      yield* Effect.log(`Searching with tags`, { tags, options });

      // If no tags specified, return all images
      if (tags.length === 0) {
        return yield* searchAll(options);
      }

      // Use the normalized CNF expression builder
      const expression = cnfToCloudinaryExpression(tags);
      yield* Effect.log(`CNF search expression: ${expression}`);

      return yield* executeSearch(expression, options);
    });

  return {
    searchByTag,
    searchByFolder,
    searchAll,
    searchByExpression,
    searchWithTags,
  } satisfies CloudinaryService;
});

// ============================================================================
// Layer
// ============================================================================

export const CloudinaryServiceLive = Layer.effect(
  CloudinaryService,
  makeCloudinaryService
);

// ============================================================================
// Convenience Functions for Gallery
// ============================================================================

export const getGalleryImages = (
  tags: CnfExpression<CloudinaryTag>,
  options?: SearchOptions
): Effect.Effect<
  readonly CloudinaryAsset[],
  CloudinarySearchError,
  CloudinaryService
> =>
  Effect.gen(function* () {
    const service = yield* CloudinaryService;

    yield* Effect.log(`Getting gallery images`, {
      tags,
      options,
    });

    // Use the searchWithTags method
    return yield* service.searchWithTags(tags, options);
  });
