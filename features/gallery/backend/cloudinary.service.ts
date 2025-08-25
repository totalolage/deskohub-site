import * as Schema from "@effect/schema/Schema";
import { v2 as cloudinary } from "cloudinary";
import { Context, Effect, Layer, pipe } from "effect";
import { env } from "@/env";

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

  readonly searchByCollection: (
    collection: string,
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
    base: { type: "folder" | "collection"; value: string },
    tags: readonly string[],
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
        // Try different tag formats
        const expressions = [
          `tags=${tag}`, // Without quotes (standard format)
          `tags=${tag.toLowerCase()}`, // Lowercase
          `tags=${tag.replace(/\s+/g, "_")}`, // Underscores
          `tags=${tag.replace(/\s+/g, "-")}`, // Hyphens
        ];

        // Try each expression until we find results
        return Effect.gen(function* () {
          for (const expr of expressions) {
            yield* Effect.log(`Trying tag expression: ${expr}`);
            const results = yield* executeSearch(expr, options);
            if (results.length > 0) {
              yield* Effect.log(
                `Found ${results.length} images with tag expression: ${expr}`
              );
              return results;
            }
          }
          yield* Effect.log(`No images found for any variation of tag: ${tag}`);
          return [];
        });
      })
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

  const searchByCollection: CloudinaryService["searchByCollection"] = (
    collection,
    options
  ) =>
    pipe(
      Effect.log(`Searching by collection: ${collection}`),
      Effect.flatMap(() => {
        // Collections are typically implemented as tags in Cloudinary
        // Try both tag and folder approaches
        return Effect.gen(function* () {
          // First try as a tag
          const tagResults = yield* searchByTag(collection, options);
          if (tagResults.length > 0) {
            yield* Effect.log(
              `Found ${tagResults.length} images in collection as tag`
            );
            return tagResults;
          }

          // Then try as a folder
          const folderResults = yield* searchByFolder(collection, options);
          if (folderResults.length > 0) {
            yield* Effect.log(
              `Found ${folderResults.length} images in collection as folder`
            );
            return folderResults;
          }

          yield* Effect.log(`No images found in collection: ${collection}`);
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

  const searchWithTags: CloudinaryService["searchWithTags"] = (
    base,
    tags,
    options
  ) =>
    pipe(
      Effect.log(`Searching ${base.type}: ${base.value} with tags`, { tags }),
      Effect.flatMap(() => {
        // Build the base expression
        let baseExpression: string;

        if (base.type === "folder") {
          baseExpression = `folder=${base.value} AND resource_type:image`;
        } else {
          // For collections, we'll use tags since collections are typically implemented as tags
          baseExpression = `tags=${base.value} AND resource_type:image`;
        }

        // If tags are provided, add them with OR logic (match any of the tags)
        if (tags.length > 0) {
          const tagExpression = tags.map((tag) => `tags=${tag}`).join(" OR ");

          // Combine base with tags using AND (must be in folder/collection AND have at least one tag)
          const fullExpression = `(${baseExpression}) AND (${tagExpression})`;

          return executeSearch(fullExpression, options);
        }

        // No tags specified, just return base results
        return executeSearch(baseExpression, options);
      })
    );

  return {
    searchByTag,
    searchByFolder,
    searchByCollection,
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
  baseType: "folder" | "collection",
  baseValue: string,
  tags: readonly string[] = [],
  options?: SearchOptions
): Effect.Effect<
  readonly CloudinaryAsset[],
  CloudinarySearchError,
  CloudinaryService
> =>
  Effect.gen(function* () {
    const service = yield* CloudinaryService;

    yield* Effect.log(`Getting gallery images`, {
      baseType,
      baseValue,
      tags,
      options,
    });

    if (!baseValue) {
      yield* Effect.logWarning(
        `${baseType} search requested but no value provided`
      );
      return [];
    }

    // Use the new searchWithTags method
    return yield* service.searchWithTags(
      { type: baseType, value: baseValue },
      tags,
      options
    );
  });
