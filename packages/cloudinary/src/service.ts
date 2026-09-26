import "server-only";

import { v2 as cloudinary } from "cloudinary";
import { Context, Duration, Effect, Layer, pipe, Schedule } from "effect";
import * as Schema from "effect/Schema";
import { decodeCloudinaryAsset } from "./asset-decoding";
import {
  type CloudinaryConfig,
  CloudinaryRuntimeConfig,
  configureCloudinarySdk,
  validateCloudinaryRuntimeConfig,
} from "./config";
import {
  CloudinaryDestroyError,
  CloudinaryRenameError,
  CloudinarySearchError,
  CloudinaryUploadError,
} from "./errors";
import { type CnfExpression, cnfToCloudinaryExpression } from "./expression";
import {
  type CloudinaryAsset,
  type CloudinaryDestroyOutcome,
  type CloudinaryPublicId,
  type CloudinarySearchCursor,
  CloudinarySearchResponseSchema,
  type SearchOptions,
  SearchOptionsSchema,
} from "./schema";

export type { CloudinaryConfig } from "./config";

/**
 * Server-side image upload input. Trusted internal values, so the shape is a
 * plain interface rather than a runtime-decoded schema.
 */
export interface CloudinaryImageUploadInput {
  readonly bytes: Uint8Array;
  readonly publicId: CloudinaryPublicId;
  readonly folder: string;
}

export interface ICloudinaryService {
  readonly getByPublicId: (
    publicId: CloudinaryPublicId
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
  readonly uploadImage: (
    input: CloudinaryImageUploadInput
  ) => Effect.Effect<CloudinaryAsset, CloudinaryUploadError>;
  readonly destroyAsset: (
    publicId: CloudinaryPublicId
  ) => Effect.Effect<CloudinaryDestroyOutcome, CloudinaryDestroyError>;
  readonly renameAsset: (
    fromPublicId: CloudinaryPublicId,
    toPublicId: CloudinaryPublicId,
    options?: { readonly overwrite?: boolean }
  ) => Effect.Effect<CloudinaryAsset, CloudinaryRenameError>;
}

export class CloudinaryService extends Context.Service<
  CloudinaryService,
  ICloudinaryService
>()("@deskohub/cloudinary/CloudinaryService") {
  static Default = Layer.effect(
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
      const uploadImage = createUploadExecutor();
      const destroyAsset = createDestroyExecutor();
      const renameAsset = createRenameExecutor();

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
        uploadImage,
        destroyAsset,
        renameAsset,
      } satisfies ICloudinaryService;
    })
  );
}

type CloudinaryProviderError = {
  readonly message?: unknown;
  readonly http_code?: unknown;
  readonly error?: {
    readonly message?: unknown;
    readonly http_code?: unknown;
  };
};

type CloudinaryRejectedValue =
  | CloudinaryProviderError
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined;

/**
 * Fixed, identifier-free search expression used for errors on the
 * by-public-ID lookup path. The looked-up public ID itself never enters
 * errors or logs: the same executor serves avatar assets, where provider
 * asset identifiers must not be logged.
 */
const publicIdLookupExpression = "public_id lookup";

function decodeAssetResponse(result: unknown) {
  return pipe(
    decodeCloudinaryAsset(result),
    Effect.mapError(
      () =>
        new CloudinarySearchError({
          message: "Cloudinary response did not match the asset schema",
          expression: publicIdLookupExpression,
        })
    )
  );
}

/**
 * Retries only transient provider failures: 5xx-style HTTP codes. 4xx failures
 * and errors without an HTTP code are definitive for the caller.
 */
function createTransientRetryPolicy<
  E extends { readonly httpCode?: number | undefined },
>(operation: string) {
  return Schedule.exponential("100 millis").pipe(
    Schedule.jittered,
    Schedule.while<E, Duration.Duration>(
      ({ input }) => input.httpCode !== undefined && input.httpCode >= 500
    ),
    Schedule.both(Schedule.recurs(2)),
    Schedule.tapOutput(([delay, attempt]) =>
      Effect.logWarning(
        `Cloudinary ${operation} retry attempt #${attempt + 1}`,
        {
          attemptNumber: attempt + 1,
          delayMs: Duration.toMillis(delay),
          maxRetries: 2,
        }
      )
    )
  );
}

const cloudinaryRetryPolicy =
  createTransientRetryPolicy<CloudinarySearchError>("search");

function readCloudinaryHttpCode(
  error: CloudinaryProviderError
): number | undefined {
  if (typeof error.http_code === "number") {
    return error.http_code;
  }

  const httpCode = error.error?.http_code;

  return typeof httpCode === "number" ? httpCode : undefined;
}

function stringifyCloudinaryError(error: CloudinaryProviderError): string {
  const message = error.message ?? error.error?.message;

  if (typeof message === "string") {
    return message;
  }

  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function toCloudinarySearchError(
  error: CloudinaryRejectedValue,
  expression: string
) {
  if (typeof error !== "object" || error === null) {
    return new CloudinarySearchError({
      message: String(error),
      expression,
    });
  }

  return new CloudinarySearchError({
    message: stringifyCloudinaryError(error),
    expression,
    httpCode: readCloudinaryHttpCode(error),
  });
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
  const defaultPageSize = config.defaultPageSize ?? 100;

  const buildSearchExpression = (
    expression: string,
    options: SearchOptions,
    pageSize: number,
    nextCursor?: CloudinarySearchCursor
  ) => {
    let search = cloudinary.search
      .expression(expression)
      .with_field("tags")
      .with_field("context")
      .max_results(pageSize);

    search = search.sort_by(
      options.sortBy ?? "created_at",
      options.sortDirection ?? "desc"
    );

    if (nextCursor) search = search.next_cursor(nextCursor);

    return search;
  };

  const loadSearchPage = (
    expression: string,
    options: SearchOptions,
    pageSize: number,
    nextCursor?: CloudinarySearchCursor
  ) =>
    pipe(
      Effect.tryPromise({
        try: () =>
          buildSearchExpression(
            expression,
            options,
            pageSize,
            nextCursor
          ).execute(),
        catch: (error) =>
          toCloudinarySearchError(error as CloudinaryRejectedValue, expression),
      }),
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
      Effect.tapError((error) =>
        Effect.logError("Cloudinary search page failed", {
          expression,
          errorMessage: error.message,
          httpCode: error.httpCode,
        })
      ),
      Effect.retry(cloudinaryRetryPolicy)
    );

  return Effect.fn("cloudinary.search")(
    function* (expression: string, options?: SearchOptions) {
      yield* Effect.annotateLogsScoped({ expression, options });
      yield* Effect.logInfo("Cloudinary search started", {
        expression,
        options,
      });

      const decodedOptions = yield* decodeSearchOptions(options, expression);
      yield* Effect.annotateLogsScoped({ decodedOptions });
      yield* Effect.logDebug("Cloudinary search options decoded", {
        decodedOptions,
      });

      const assets: CloudinaryAsset[] = [];
      let nextCursor: CloudinarySearchCursor | undefined;
      let remainingResults = decodedOptions.maxResults;
      let hasNextPage = true;

      yield* Effect.whileLoop({
        while: () => hasNextPage,
        body: () =>
          loadSearchPage(
            expression,
            decodedOptions,
            Math.min(remainingResults ?? defaultPageSize, defaultPageSize),
            nextCursor
          ),
        step: (response) => {
          const pageAssets =
            remainingResults === undefined
              ? response.resources
              : response.resources.slice(0, remainingResults);

          assets.push(...pageAssets);

          if (remainingResults !== undefined) {
            remainingResults -= pageAssets.length;
          }

          nextCursor = response.next_cursor;
          hasNextPage =
            nextCursor !== undefined &&
            (remainingResults === undefined || remainingResults > 0);
        },
      });

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

      return assets;
    },
    (effect, expression, options) =>
      effect.pipe(
        Effect.tapError((error) =>
          Effect.logError("Cloudinary search failed", {
            expression,
            errorMessage: error.message,
            httpCode: error.httpCode,
          })
        ),
        Effect.scoped,
        Effect.annotateLogs({ expression, options })
      )
  );
}

function createPublicIdLookupExecutor() {
  // The looked-up public ID (and any asset-bearing response payload) is kept
  // out of logs and annotations entirely: this executor serves the avatar
  // path, where provider asset identifiers must never be logged. Only fixed
  // operation/outcome codes and safe numeric metadata are emitted.
  return Effect.fn("cloudinary.api.resource")(
    function* (publicId: CloudinaryPublicId) {
      yield* Effect.logInfo("Cloudinary public ID lookup started");

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
            toCloudinarySearchError(
              error as CloudinaryRejectedValue,
              publicIdLookupExpression
            ),
        }),
        Effect.flatMap((result) => decodeAssetResponse(result)),
        Effect.tap(() =>
          Effect.logInfo("Cloudinary public ID lookup completed")
        ),
        Effect.tapError((error) =>
          Effect.logError("Cloudinary public ID lookup failed", {
            errorMessage: error.message,
            httpCode: error.httpCode,
          })
        ),
        Effect.retry(cloudinaryRetryPolicy)
      );
    },
    (effect) => Effect.scoped(effect)
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

function toUploadError(
  error: CloudinaryRejectedValue,
  publicId: CloudinaryPublicId
) {
  const httpCode =
    typeof error === "object" && error !== null
      ? readCloudinaryHttpCode(error)
      : undefined;

  return new CloudinaryUploadError({
    message: "Cloudinary image upload failed",
    publicId,
    httpCode,
  });
}

function createUploadExecutor() {
  const uploadRetryPolicy =
    createTransientRetryPolicy<CloudinaryUploadError>("image upload");

  const performUpload = (input: CloudinaryImageUploadInput) =>
    Effect.tryPromise({
      try: () =>
        new Promise<unknown>((resolveUpload, rejectUpload) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              public_id: input.publicId,
              folder: input.folder,
              resource_type: "image",
            },
            (error, result) => {
              if (error) {
                rejectUpload(error);
                return;
              }

              if (!result) {
                rejectUpload(
                  new CloudinaryUploadError({
                    message: "Cloudinary image upload returned no result",
                    publicId: input.publicId,
                  })
                );
                return;
              }

              resolveUpload(result);
            }
          );

          stream.end(input.bytes);
        }),
      catch: (error) =>
        error instanceof CloudinaryUploadError
          ? error
          : toUploadError(error as CloudinaryRejectedValue, input.publicId),
    });

  return Effect.fn("cloudinary.upload")(
    function* (input: CloudinaryImageUploadInput) {
      // The uploaded public ID and its folder (which may embed an account
      // identifier) never enter logs or annotations: this executor serves
      // the avatar path, where provider asset identifiers must never be
      // logged. Only fixed operation/outcome codes and safe numeric
      // metadata are emitted.
      yield* Effect.logInfo("Cloudinary image upload started", {
        byteLength: input.bytes.byteLength,
      });

      return yield* pipe(
        performUpload(input),
        Effect.flatMap((result) =>
          pipe(
            decodeCloudinaryAsset(result),
            Effect.mapError(
              () =>
                new CloudinaryUploadError({
                  message:
                    "Cloudinary upload response did not match the asset schema",
                  publicId: input.publicId,
                })
            )
          )
        ),
        Effect.tap((asset) =>
          Effect.logInfo("Cloudinary image upload completed", {
            width: asset.width,
            height: asset.height,
            format: asset.format,
            version: asset.version,
          })
        ),
        Effect.tapError((error) =>
          Effect.logError("Cloudinary image upload failed", {
            errorMessage: error.message,
            httpCode: error.httpCode,
          })
        ),
        Effect.retry(uploadRetryPolicy)
      );
    },
    (effect) => Effect.scoped(effect)
  );
}

function toDestroyOutcome(
  result: string
): CloudinaryDestroyOutcome | undefined {
  if (result === "ok") {
    return "destroyed";
  }

  if (result === "not found") {
    return "not-found";
  }

  return undefined;
}

function createDestroyExecutor() {
  const destroyRetryPolicy =
    createTransientRetryPolicy<CloudinaryDestroyError>("asset destroy");

  const performDestroy = (publicId: CloudinaryPublicId) =>
    Effect.tryPromise({
      try: () =>
        cloudinary.uploader.destroy(publicId) as Promise<{ result?: unknown }>,
      catch: (error) => {
        const httpCode =
          typeof error === "object" && error !== null
            ? readCloudinaryHttpCode(error as CloudinaryProviderError)
            : undefined;

        return new CloudinaryDestroyError({
          message: "Cloudinary asset destroy request failed",
          publicId,
          outcome:
            httpCode !== undefined && httpCode < 500 ? "failed" : "uncertain",
          httpCode,
        });
      },
    });

  return Effect.fn("cloudinary.destroy")(
    function* (publicId: CloudinaryPublicId) {
      // The destroyed public ID never enters logs or annotations: this
      // executor serves the avatar path, where provider asset identifiers
      // must never be logged. Only the fixed outcome code is emitted.
      yield* Effect.logInfo("Cloudinary asset destroy started");

      return yield* pipe(
        performDestroy(publicId),
        Effect.flatMap((result) => {
          const outcome =
            typeof result.result === "string"
              ? toDestroyOutcome(result.result)
              : undefined;

          if (outcome === undefined) {
            return Effect.fail(
              new CloudinaryDestroyError({
                message:
                  "Cloudinary asset destroy returned an unrecognized outcome",
                publicId,
                outcome: "uncertain",
              })
            );
          }

          return Effect.succeed(outcome);
        }),
        Effect.tap((outcome) =>
          Effect.logInfo("Cloudinary asset destroy completed", { outcome })
        ),
        Effect.tapError((error) =>
          Effect.logError("Cloudinary asset destroy failed", {
            outcome: error.outcome,
            errorMessage: error.message,
            httpCode: error.httpCode,
          })
        ),
        Effect.retry(destroyRetryPolicy)
      );
    },
    (effect) => Effect.scoped(effect)
  );
}

function classifyRenameFailure(
  error: CloudinaryRejectedValue,
  fromPublicId: CloudinaryPublicId,
  toPublicId: CloudinaryPublicId
) {
  const httpCode =
    typeof error === "object" && error !== null
      ? readCloudinaryHttpCode(error)
      : undefined;

  const rawMessage =
    typeof error === "object" && error !== null
      ? (error.message ?? error.error?.message)
      : undefined;

  const message =
    typeof rawMessage === "string" ? rawMessage.toLowerCase() : "";

  if (
    httpCode === 409 ||
    message.includes("already exists") ||
    message.includes("already a file")
  ) {
    return new CloudinaryRenameError({
      message: "Cloudinary rename target public ID already exists",
      fromPublicId,
      toPublicId,
      reason: "target-exists",
      httpCode,
    });
  }

  if (httpCode === 404) {
    return new CloudinaryRenameError({
      message: "Cloudinary rename source public ID is missing",
      fromPublicId,
      toPublicId,
      reason: "source-missing",
      httpCode,
    });
  }

  return new CloudinaryRenameError({
    message: "Cloudinary asset rename failed",
    fromPublicId,
    toPublicId,
    reason: "failed",
    httpCode,
  });
}

function createRenameExecutor() {
  const renameRetryPolicy =
    createTransientRetryPolicy<CloudinaryRenameError>("asset rename");

  const performRename = (
    fromPublicId: CloudinaryPublicId,
    toPublicId: CloudinaryPublicId,
    overwrite: boolean
  ) =>
    Effect.tryPromise({
      try: () =>
        cloudinary.uploader.rename(fromPublicId, toPublicId, {
          overwrite,
        }) as Promise<unknown>,
      catch: (error) =>
        classifyRenameFailure(
          error as CloudinaryRejectedValue,
          fromPublicId,
          toPublicId
        ),
    });

  return Effect.fn("cloudinary.rename")(
    function* (
      fromPublicId: CloudinaryPublicId,
      toPublicId: CloudinaryPublicId,
      options?: { readonly overwrite?: boolean }
    ) {
      const overwrite = options?.overwrite ?? false;

      // The renamed public IDs never enter logs or annotations: this
      // executor serves the avatar path, where provider asset identifiers
      // must never be logged. Only fixed operation/outcome codes and safe
      // numeric metadata are emitted.
      yield* Effect.logInfo("Cloudinary asset rename started", { overwrite });

      return yield* pipe(
        performRename(fromPublicId, toPublicId, overwrite),
        Effect.flatMap((result) =>
          pipe(
            decodeCloudinaryAsset(result),
            Effect.mapError(
              () =>
                new CloudinaryRenameError({
                  message:
                    "Cloudinary rename response did not match the asset schema",
                  fromPublicId,
                  toPublicId,
                  reason: "failed",
                })
            )
          )
        ),
        Effect.tap((asset) =>
          Effect.logInfo("Cloudinary asset rename completed", {
            version: asset.version,
          })
        ),
        Effect.tapError((error) =>
          Effect.logError("Cloudinary asset rename failed", {
            reason: error.reason,
            errorMessage: error.message,
            httpCode: error.httpCode,
          })
        ),
        Effect.retry(renameRetryPolicy)
      );
    },
    (effect) => Effect.scoped(effect)
  );
}
