import "server-only";

import { v2 as cloudinary } from "cloudinary";
import { Context, Duration, Effect, Layer, pipe, Schedule } from "effect";
import * as Schema from "effect/Schema";
import {
  type CloudinaryConfig,
  CloudinaryRuntimeConfig,
  configureCloudinarySdk,
  validateCloudinaryRuntimeConfig,
} from "./config";
import { CloudinarySearchError } from "./errors";
import { type CnfExpression, cnfToCloudinaryExpression } from "./expression";
import {
  type CloudinaryAsset,
  CloudinaryAssetSchema,
  CloudinarySearchResponseSchema,
  type SearchOptions,
  SearchOptionsSchema,
} from "./schema";

export type { CloudinaryConfig } from "./config";

export interface ICloudinaryService {
  readonly getByPublicId: (
    publicId: string
  ) => Effect.Effect<CloudinaryAsset, CloudinarySearchError>;
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
  readonly searchWithTags: <Tag extends string>(
    tags: CnfExpression<Tag>,
    options?: SearchOptions
  ) => Effect.Effect<readonly CloudinaryAsset[], CloudinarySearchError>;
}

export class CloudinaryService extends Context.Service<
  CloudinaryService,
  ICloudinaryService
>()("@deskohub/cloudinary/CloudinaryService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const rawConfig = yield* CloudinaryRuntimeConfig;
      const config = yield* validateCloudinaryRuntimeConfig(rawConfig);
      yield* configureCloudinarySdk(config);

      yield* Effect.logDebug("Cloudinary service initialized", {
        serviceName: config.serviceName,
        cloudName: config.cloudName,
      });

      const executeSearch = createSearchExecutor(config);
      const getByPublicId = createPublicIdLookupExecutor();

      const searchByTag: ICloudinaryService["searchByTag"] = (tag, options) =>
        executeSearch(`tags=${tag} AND resource_type:image`, options);

      const searchByFolder: ICloudinaryService["searchByFolder"] = (
        folder,
        options
      ) =>
        Effect.gen(function* () {
          yield* Effect.annotateLogsScoped({ folder, options });
          yield* Effect.logInfo("Cloudinary folder search started", { folder });

          const expressions = [`folder=${folder}`, `folder:${folder}`];

          for (const expression of expressions) {
            const assets = yield* executeSearch(
              `${expression} AND resource_type:image`,
              options
            );

            if (assets.length > 0) {
              yield* Effect.annotateLogsScoped({ result: assets });
              yield* Effect.logInfo("Cloudinary folder search completed", {
                folder,
                expression,
                resultCount: assets.length,
              });
              return assets;
            }

            yield* Effect.logWarning(
              "Cloudinary folder search expression returned no assets",
              {
                folder,
                expression,
              }
            );
          }

          yield* Effect.annotateLogsScoped({ result: [] });
          yield* Effect.logWarning(
            "Cloudinary folder search completed with no assets",
            {
              folder,
            }
          );
          return [];
        }).pipe(Effect.scoped, Effect.annotateLogs({ folder, options }));

      const searchAll: ICloudinaryService["searchAll"] = (options) =>
        executeSearch("resource_type:image", options);

      const searchByExpression: ICloudinaryService["searchByExpression"] = (
        expression,
        options
      ) => executeSearch(expression, options);

      const searchWithTags: ICloudinaryService["searchWithTags"] = (
        tags,
        options
      ) => {
        if (tags.length === 0) {
          return searchAll(options);
        }

        return executeSearch(cnfToCloudinaryExpression(tags), options);
      };

      return {
        getByPublicId,
        searchByTag,
        searchByFolder,
        searchAll,
        searchByExpression,
        searchWithTags,
      } satisfies ICloudinaryService;
    })
  );
}

function decodeAssetResponse(result: unknown, publicId: string) {
  return pipe(
    Schema.decodeUnknownEffect(CloudinaryAssetSchema)(result),
    Effect.mapError(
      () =>
        new CloudinarySearchError({
          message: "Cloudinary response did not match the asset schema",
          expression: `public_id=${publicId}`,
        })
    )
  );
}

const cloudinaryRetryPolicy = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.while<CloudinarySearchError, Duration.Duration>(
    ({ input }) => input.httpCode !== undefined && input.httpCode >= 500
  ),
  Schedule.both(Schedule.recurs(2)),
  Schedule.tapOutput(([delay, attempt]) =>
    Effect.logWarning(`Cloudinary search retry attempt #${attempt + 1}`, {
      attemptNumber: attempt + 1,
      delayMs: Duration.toMillis(delay),
      maxRetries: 2,
    })
  )
);

function readCloudinaryHttpCode(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "http_code" in error &&
    typeof error.http_code === "number"
  ) {
    return error.http_code;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    typeof error.error === "object" &&
    error.error !== null &&
    "http_code" in error.error &&
    typeof error.error.http_code === "number"
  ) {
    return error.error.http_code;
  }

  return undefined;
}

function stringifyUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    return JSON.stringify(error);
  }

  return String(error);
}

function decodeSearchResponse(result: unknown, expression: string) {
  return pipe(
    Schema.decodeUnknownEffect(CloudinarySearchResponseSchema)(result),
    Effect.mapError(
      () =>
        new CloudinarySearchError({
          message:
            "Cloudinary response did not match the gallery search schema",
          expression,
        })
    )
  );
}

function decodeSearchOptions(options: unknown, expression: string) {
  return pipe(
    Schema.decodeUnknownEffect(SearchOptionsSchema)(options ?? {}),
    Effect.mapError(
      () =>
        new CloudinarySearchError({
          message: "Cloudinary search options did not match the schema",
          expression,
        })
    )
  );
}

function createSearchExecutor(config: CloudinaryConfig) {
  const defaultMaxResults = config.defaultMaxResults ?? 100;

  const buildSearchExpression = (
    expression: string,
    options?: SearchOptions
  ) => {
    let search = cloudinary.search
      .expression(expression)
      .with_field("tags")
      .with_field("context")
      .max_results(options?.maxResults ?? defaultMaxResults);

    search = search.sort_by(
      options?.sortBy ?? "created_at",
      options?.sortDirection ?? "desc"
    );

    return search;
  };

  return Effect.fn("cloudinary.search")(
    function* (expression: string, options?: SearchOptions) {
      yield* Effect.annotateLogsScoped({ expression, options });
      yield* Effect.logInfo("Cloudinary search started", {
        expression,
        options,
      });

      return yield* pipe(
        decodeSearchOptions(options, expression),
        Effect.tap((decodedOptions) =>
          Effect.gen(function* () {
            yield* Effect.annotateLogsScoped({ decodedOptions });
            yield* Effect.logDebug("Cloudinary search options decoded", {
              decodedOptions,
            });
          })
        ),
        Effect.flatMap((decodedOptions) =>
          Effect.tryPromise({
            try: () =>
              buildSearchExpression(expression, decodedOptions).execute(),
            catch: (error) =>
              new CloudinarySearchError({
                message: stringifyUnknownError(error),
                expression,
                httpCode: readCloudinaryHttpCode(error),
              }),
          })
        ),
        Effect.tap((rawResult) =>
          Effect.gen(function* () {
            yield* Effect.annotateLogsScoped({ rawResult });
            yield* Effect.logDebug("Cloudinary provider response received", {
              rawResult,
            });
          })
        ),
        Effect.flatMap((result) => decodeSearchResponse(result, expression)),
        Effect.tap((response) =>
          Effect.gen(function* () {
            yield* Effect.annotateLogsScoped({ response });
            yield* Effect.logDebug("Cloudinary search response decoded", {
              response,
            });
          })
        ),
        Effect.map((response) => response.resources),
        Effect.tap((assets) =>
          Effect.gen(function* () {
            yield* Effect.annotateLogsScoped({ result: assets });
            if (assets.length === 0) {
              yield* Effect.logWarning("Cloudinary search returned no assets", {
                expression,
                options,
              });
            }
            yield* Effect.logInfo("Cloudinary search completed", {
              expression,
              resultCount: assets.length,
              options,
            });
          })
        ),
        Effect.tapError((error) =>
          Effect.logError("Cloudinary search failed", {
            expression,
            errorMessage: error.message,
            httpCode: error.httpCode,
          })
        ),
        Effect.retry(cloudinaryRetryPolicy)
      );
    },
    (effect, expression, options) =>
      effect.pipe(Effect.scoped, Effect.annotateLogs({ expression, options }))
  );
}

function createPublicIdLookupExecutor() {
  return Effect.fn("cloudinary.api.resource")(
    function* (publicId: string) {
      if (!publicId.trim()) {
        return yield* Effect.fail(
          new CloudinarySearchError({
            message: "Cloudinary publicId is required",
            expression: "public_id=",
          })
        );
      }

      yield* Effect.annotateLogsScoped({ publicId });
      yield* Effect.logInfo("Cloudinary public ID lookup started", {
        publicId,
      });

      return yield* pipe(
        Effect.tryPromise({
          try: () =>
            cloudinary.api.resource(publicId, {
              resource_type: "image",
              type: "upload",
              tags: true,
              context: true,
            }),
          catch: (error) =>
            new CloudinarySearchError({
              message: stringifyUnknownError(error),
              expression: `public_id=${publicId}`,
              httpCode: readCloudinaryHttpCode(error),
            }),
        }),
        Effect.tap((rawResult) =>
          Effect.gen(function* () {
            yield* Effect.annotateLogsScoped({ rawResult });
            yield* Effect.logDebug("Cloudinary provider response received", {
              rawResult,
            });
          })
        ),
        Effect.flatMap((result) => decodeAssetResponse(result, publicId)),
        Effect.tap((asset) =>
          Effect.gen(function* () {
            yield* Effect.annotateLogsScoped({ result: asset });
            yield* Effect.logInfo("Cloudinary public ID lookup completed", {
              publicId,
            });
          })
        ),
        Effect.tapError((error) =>
          Effect.logError("Cloudinary public ID lookup failed", {
            publicId,
            errorMessage: error.message,
            httpCode: error.httpCode,
          })
        ),
        Effect.retry(cloudinaryRetryPolicy)
      );
    },
    (effect, publicId) =>
      effect.pipe(Effect.scoped, Effect.annotateLogs({ publicId }))
  );
}

export const getGalleryImages = Effect.fn("getGalleryImages")(
  function* <Tag extends string>(
    tags: CnfExpression<Tag>,
    options?: SearchOptions
  ) {
    yield* Effect.annotateLogsScoped({ tags, options });
    yield* Effect.logInfo("Cloudinary gallery images lookup started", {
      tags,
      options,
    });

    const service = yield* CloudinaryService;

    const result = yield* service.searchWithTags(tags, options).pipe(
      Effect.tapError((error) =>
        Effect.logError("Cloudinary gallery images lookup failed", {
          tags,
          options,
          errorMessage: error.message,
          httpCode: error.httpCode,
        })
      )
    );

    yield* Effect.annotateLogsScoped({ result });
    if (result.length === 0) {
      yield* Effect.logWarning(
        "Cloudinary gallery images lookup returned no assets",
        {
          tags,
          options,
        }
      );
    }
    yield* Effect.logInfo("Cloudinary gallery images lookup completed", {
      tags,
      options,
      resultCount: result.length,
    });

    return result;
  },
  (effect, tags, options) =>
    effect.pipe(Effect.scoped, Effect.annotateLogs({ tags, options }))
);
