import "server-only";

import * as Schema from "@effect/schema/Schema";
import { v2 as cloudinary } from "cloudinary";
import { Context, Effect, Layer, pipe, Schedule } from "effect";
import { CloudinarySearchError } from "./errors";
import { type CnfExpression, cnfToCloudinaryExpression } from "./expression";
import {
  type CloudinaryAsset,
  CloudinarySearchResponseSchema,
  type SearchOptions,
  SearchOptionsSchema,
} from "./schema";

export interface CloudinaryConfig {
  readonly cloudName: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly defaultMaxResults?: number;
  readonly serviceName?: string;
}

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
  readonly searchWithTags: <Tag extends string>(
    tags: CnfExpression<Tag>,
    options?: SearchOptions
  ) => Effect.Effect<readonly CloudinaryAsset[], CloudinarySearchError>;
}

export const CloudinaryService = Context.GenericTag<CloudinaryService>(
  "@deskohub/cloudinary/CloudinaryService"
);

const cloudinaryRetryPolicy = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.intersect(Schedule.recurs(2)),
  Schedule.whileInput<CloudinarySearchError>(
    (error) => error.httpCode !== undefined && error.httpCode >= 500
  )
);

function readCloudinaryHttpCode(error: unknown): number | undefined {
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
    Schema.decodeUnknown(CloudinarySearchResponseSchema)(result),
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
    Schema.decodeUnknown(SearchOptionsSchema)(options ?? {}),
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

export function makeCloudinaryService(config: CloudinaryConfig) {
  return Effect.gen(function* () {
    yield* Effect.sync(() => {
      cloudinary.config({
        cloud_name: config.cloudName,
        api_key: config.apiKey,
        api_secret: config.apiSecret,
      });
    });

    yield* Effect.logDebug("Cloudinary service initialized", {
      serviceName: config.serviceName,
      cloudName: config.cloudName,
    });

    const executeSearch = createSearchExecutor(config);

    const searchByTag: CloudinaryService["searchByTag"] = (tag, options) =>
      executeSearch(`tags=${tag} AND resource_type:image`, options);

    const searchByFolder: CloudinaryService["searchByFolder"] = (
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

    const searchAll: CloudinaryService["searchAll"] = (options) =>
      executeSearch("resource_type:image", options);

    const searchByExpression: CloudinaryService["searchByExpression"] = (
      expression,
      options
    ) => executeSearch(expression, options);

    const searchWithTags: CloudinaryService["searchWithTags"] = (
      tags,
      options
    ) => {
      if (tags.length === 0) {
        return searchAll(options);
      }

      return executeSearch(cnfToCloudinaryExpression(tags), options);
    };

    return {
      searchByTag,
      searchByFolder,
      searchAll,
      searchByExpression,
      searchWithTags,
    } satisfies CloudinaryService;
  });
}

export function makeCloudinaryServiceLive(config: CloudinaryConfig) {
  return Layer.effect(CloudinaryService, makeCloudinaryService(config));
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
