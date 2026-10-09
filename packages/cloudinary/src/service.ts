import "server-only";

import { v2 as cloudinary } from "cloudinary";
import { Context, Effect, Layer, pipe } from "effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { decodeCloudinaryAsset } from "./asset-decoding";
import {
  type CloudinaryConfig,
  CloudinaryRuntimeConfig,
  configureCloudinarySdk,
  validateCloudinaryRuntimeConfig,
} from "./config";
import {
  CloudinaryDestroyError,
  CloudinaryPrefixDeleteError,
  CloudinaryRenameError,
  CloudinarySearchError,
  CloudinaryUploadError,
} from "./errors";
import type { CnfExpression } from "./expression";
import { createTransientRetryPolicy } from "./retry";
import {
  type CloudinaryAsset,
  type CloudinaryDestroyOutcome,
  type CloudinaryPublicId,
  type CloudinarySearchCursor,
  CloudinarySearchResponseSchema,
  type SearchOptions,
  SearchOptionsSchema,
} from "./schema";
import { makeTaggedAssetLister } from "./tag-list";
import { untracedFetch } from "./untraced-fetch";

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
  readonly searchByFolder: (
    folder: string,
    options?: SearchOptions
  ) => Effect.Effect<readonly CloudinaryAsset[], CloudinarySearchError>;
  /**
   * Lists the assets in one folder without ever logging the folder, its
   * assets, raw provider responses, or provider failure text. This is the
   * sanitized sibling of `searchByFolder` for account-derived folders
   * (avatar staging), where identifiers must not reach logs.
   */
  readonly listFolderAssets: (
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
  /**
   * Lists image assets matching a tag expression from Cloudinary's
   * CDN-cached tag resource lists instead of the Admin Search API, so it
   * spends no Admin API quota. A list may lag tag changes by up to a minute.
   * Groups without a positive tag select nothing.
   */
  readonly listTaggedAssets: <Tag extends string>(
    tags: CnfExpression<Tag>,
    options?: SearchOptions
  ) => Effect.Effect<readonly CloudinaryAsset[], CloudinarySearchError>;
  readonly uploadImage: (
    input: CloudinaryImageUploadInput
  ) => Effect.Effect<CloudinaryAsset, CloudinaryUploadError>;
  readonly destroyAsset: (
    publicId: CloudinaryPublicId
  ) => Effect.Effect<CloudinaryDestroyOutcome, CloudinaryDestroyError>;
  readonly deleteResourcesByPublicIdPrefix: (
    prefix: CloudinaryPublicId
  ) => Effect.Effect<void, CloudinaryPrefixDeleteError>;
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
      const httpClient = yield* HttpClient.HttpClient;
      const config = yield* validateCloudinaryRuntimeConfig(rawConfig);
      yield* configureCloudinarySdk(config);

      yield* Effect.logDebug("Cloudinary service initialized");

      const executeSearch = createSearchExecutor(config);
      const executeSanitizedSearch = createSearchExecutor(config, true);
      const getByPublicId = createPublicIdLookupExecutor();
      const uploadImage = createUploadExecutor();
      const destroyAsset = createDestroyExecutor();
      const deleteResourcesByPublicIdPrefix = createPrefixDeleteExecutor();
      const renameAsset = createRenameExecutor();
      const listTaggedAssets: ICloudinaryService["listTaggedAssets"] =
        makeTaggedAssetLister(config, httpClient);

      const listFolderAssets: ICloudinaryService["listFolderAssets"] = (
        folder,
        options
      ) =>
        Effect.gen(function* () {
          yield* Effect.logInfo("Cloudinary folder listing started");

          const expressions = [`folder=${folder}`, `folder:${folder}`];

          for (const expression of expressions) {
            const assets = yield* executeSanitizedSearch(
              `${expression} AND resource_type:image`,
              options
            );

            if (assets.length > 0) {
              yield* Effect.logInfo("Cloudinary folder listing completed", {
                resultCount: assets.length,
              });
              return assets;
            }

            yield* Effect.logDebug(
              "Cloudinary folder listing expression returned no assets"
            );
          }

          yield* Effect.logInfo("Cloudinary folder listing completed", {
            resultCount: 0,
          });
          return [];
        });

      const searchByFolder: ICloudinaryService["searchByFolder"] = (
        folder,
        options
      ) =>
        Effect.gen(function* () {
          yield* Effect.logInfo("Cloudinary folder search started");

          const expressions = [`folder=${folder}`, `folder:${folder}`];

          for (const expression of expressions) {
            const assets = yield* executeSearch(
              `${expression} AND resource_type:image`,
              options
            );

            if (assets.length > 0) {
              yield* Effect.logInfo("Cloudinary folder search completed");
              return assets;
            }

            yield* Effect.logWarning(
              "Cloudinary folder search expression returned no assets"
            );
          }

          yield* Effect.logWarning(
            "Cloudinary folder search completed with no assets"
          );
          return [];
        }).pipe(Effect.scoped);

      const searchAll: ICloudinaryService["searchAll"] = (options) =>
        executeSearch("resource_type:image", options);

      const searchByExpression: ICloudinaryService["searchByExpression"] = (
        expression,
        options
      ) => executeSearch(expression, options);

      return {
        getByPublicId,
        searchByFolder,
        listFolderAssets,
        searchAll,
        searchByExpression,
        listTaggedAssets,
        uploadImage,
        destroyAsset,
        deleteResourcesByPublicIdPrefix,
        renameAsset,
      } satisfies ICloudinaryService;
    })
  );

  /**
   * The service wired to the platform `fetch` for tag list requests. Tag list
   * URLs carry a signature, so the requests run with tracing suppressed and
   * no fetch or HTTP instrumentation records them.
   */
  static Live = this.Default.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, untracedFetch))
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

/**
 * Fixed, identifier-free failure message for the by-public-ID lookup path.
 * The provider's rejection text can echo the requested asset identifier, so
 * it is never carried into this error message.
 */
const publicIdLookupFailureMessage = "Cloudinary public ID lookup failed";

function toPublicIdLookupSearchError(error: CloudinaryRejectedValue) {
  const httpCode =
    typeof error === "object" && error !== null
      ? readCloudinaryHttpCode(error)
      : undefined;

  return new CloudinarySearchError({
    message: publicIdLookupFailureMessage,
    expression: publicIdLookupExpression,
    httpCode,
  });
}

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

function toCloudinarySearchError(error: CloudinaryRejectedValue) {
  // Provider rejection text and the caller-supplied expression never enter
  // the typed error: both can carry identifiers or secrets that propagate
  // verbatim into framework error reporting. Only the numeric HTTP code is
  // retained, so 5xx retry and avatar 404 handling keep working, and the raw
  // rejection is never attached as a cause or payload.
  const httpCode =
    typeof error === "object" && error !== null
      ? readCloudinaryHttpCode(error)
      : undefined;

  return new CloudinarySearchError({
    message: searchFailureMessage,
    expression: searchExpressionLabel,
    httpCode,
  });
}

/**
 * Fixed, identifier-free failure values for the generic search path. Provider
 * rejection text and the caller-supplied expression can carry identifiers or
 * secrets, so errors carry only these fixed labels plus the numeric HTTP code.
 */
const searchFailureMessage = "Cloudinary search failed";
const searchExpressionLabel = "gallery search";

/**
 * Fixed, identifier-free failure label for the sanitized folder-listing
 * path. The listed folder may embed an account identifier, so neither the
 * expression, the provider's rejection text, nor any asset payload may
 * reach the error or the logs. The HTTP code remains available to the retry
 * policy and typed error contract, but is never logged.
 */
const folderListingExpressionLabel = "folder listing";
const folderListingFailureMessage = "Cloudinary folder listing failed";

function toSanitizedFolderListingError(error: CloudinaryRejectedValue) {
  const httpCode =
    typeof error === "object" && error !== null
      ? readCloudinaryHttpCode(error)
      : undefined;

  return new CloudinarySearchError({
    message: folderListingFailureMessage,
    expression: folderListingExpressionLabel,
    httpCode,
  });
}

function decodeSearchResponse(result: unknown) {
  return pipe(
    Schema.decodeUnknownEffect(CloudinarySearchResponseSchema)(result),
    Effect.mapError(
      () =>
        new CloudinarySearchError({
          message:
            "Cloudinary response did not match the gallery search schema",
          expression: searchExpressionLabel,
        })
    )
  );
}

function decodeSearchOptions(options: unknown) {
  return pipe(
    Schema.decodeUnknownEffect(SearchOptionsSchema)(options ?? {}),
    Effect.mapError(
      () =>
        new CloudinarySearchError({
          message: "Cloudinary search options did not match the schema",
          expression: searchExpressionLabel,
        })
    )
  );
}

function createSearchExecutor(config: CloudinaryConfig, sanitized = false) {
  const defaultPageSize = config.defaultPageSize ?? 100;

  // In sanitized mode the real expression still drives the provider call,
  // while errors and logs use fixed labels instead of the expression or
  // provider response data. The generic path sanitizes provider rejection
  // text and the expression the same way; both errors carry fixed labels.
  const toSearchError = (error: CloudinaryRejectedValue) =>
    sanitized
      ? toSanitizedFolderListingError(error)
      : toCloudinarySearchError(error);

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
        catch: (error) => toSearchError(error as CloudinaryRejectedValue),
      }),
      Effect.flatMap((result) => decodeSearchResponse(result)),
      Effect.tapError(() =>
        sanitized
          ? Effect.logError(folderListingFailureMessage)
          : Effect.logError("Cloudinary search page failed")
      ),
      Effect.retry(cloudinaryRetryPolicy)
    );

  return Effect.fn("cloudinary.search")(
    function* (expression: string, options?: SearchOptions) {
      yield* sanitized
        ? Effect.logInfo("Cloudinary folder listing page started")
        : Effect.logInfo("Cloudinary search started");

      const decodedOptions = yield* decodeSearchOptions(options);
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

      if (assets.length === 0) {
        yield* sanitized
          ? Effect.logWarning("Cloudinary folder listing returned no assets")
          : Effect.logWarning("Cloudinary search returned no assets");
      }
      yield* sanitized
        ? Effect.logInfo("Cloudinary folder listing page completed", {
            resultCount: assets.length,
          })
        : Effect.logInfo("Cloudinary search completed");

      return assets;
    },
    (effect) =>
      sanitized
        ? effect.pipe(
            Effect.tapError(() => Effect.logError(folderListingFailureMessage)),
            Effect.scoped
          )
        : effect.pipe(
            Effect.tapError(() => Effect.logError("Cloudinary search failed")),
            Effect.scoped
          )
  );
}

function createPublicIdLookupExecutor() {
  // The looked-up public ID (and any asset-bearing response payload) is kept
  // out of logs and annotations entirely: this executor serves the avatar
  // path, where provider asset identifiers must never be logged. Only fixed
  // operation messages are emitted.
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
            toPublicIdLookupSearchError(error as CloudinaryRejectedValue),
        }),
        Effect.flatMap((result) => decodeAssetResponse(result)),
        Effect.tap(() =>
          Effect.logInfo("Cloudinary public ID lookup completed")
        ),
        Effect.tapError(() =>
          Effect.logError("Cloudinary public ID lookup failed")
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
    yield* Effect.logInfo("Cloudinary gallery images lookup started");

    const service = yield* CloudinaryService;

    const result = yield* service
      .listTaggedAssets(tags, options)
      .pipe(
        Effect.tapError(() =>
          Effect.logError("Cloudinary gallery images lookup failed")
        )
      );

    if (result.length === 0) {
      yield* Effect.logWarning(
        "Cloudinary gallery images lookup returned no assets"
      );
    }
    yield* Effect.logInfo("Cloudinary gallery images lookup completed");

    return result;
  },
  (effect) => effect.pipe(Effect.scoped)
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
      // the avatar path, where provider asset identifiers and provider
      // details must never be logged. Only fixed operation/outcome codes are
      // emitted.
      yield* Effect.logInfo("Cloudinary image upload started");

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
        Effect.tap(() => Effect.logInfo("Cloudinary image upload completed")),
        Effect.tapError(() =>
          Effect.logError("Cloudinary image upload failed")
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
        cloudinary.uploader.destroy(publicId, {
          invalidate: true,
        }) as Promise<{ result?: unknown }>,
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
          })
        ),
        Effect.retry(destroyRetryPolicy)
      );
    },
    (effect) => Effect.scoped(effect)
  );
}

const prefixDeletePageLimit = 25;

type PrefixDeletePage = {
  readonly nextCursor?: string;
};

function decodePrefixDeletePage(
  result: unknown
): Effect.Effect<PrefixDeletePage, CloudinaryPrefixDeleteError> {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return Effect.fail(
      new CloudinaryPrefixDeleteError({
        message: "Cloudinary prefix delete returned an invalid response",
        outcome: "uncertain",
      })
    );
  }

  const response = result as {
    readonly deleted?: unknown;
    readonly partial?: unknown;
    readonly next_cursor?: unknown;
  };
  if (
    typeof response.deleted !== "object" ||
    response.deleted === null ||
    Array.isArray(response.deleted) ||
    typeof response.partial !== "boolean"
  ) {
    return Effect.fail(
      new CloudinaryPrefixDeleteError({
        message: "Cloudinary prefix delete returned an invalid response",
        outcome: "uncertain",
      })
    );
  }

  const statuses = Object.values(response.deleted);
  if (
    statuses.some((status) => status !== "deleted" && status !== "not found")
  ) {
    return Effect.fail(
      new CloudinaryPrefixDeleteError({
        message: "Cloudinary prefix delete returned an incomplete result",
        outcome: "uncertain",
      })
    );
  }

  if (response.partial) {
    return typeof response.next_cursor === "string" &&
      response.next_cursor.length > 0
      ? Effect.succeed({
          nextCursor: response.next_cursor,
        } satisfies PrefixDeletePage)
      : Effect.fail(
          new CloudinaryPrefixDeleteError({
            message: "Cloudinary prefix delete returned an invalid cursor",
            outcome: "uncertain",
          })
        );
  }

  return response.next_cursor === undefined
    ? Effect.succeed({} satisfies PrefixDeletePage)
    : Effect.fail(
        new CloudinaryPrefixDeleteError({
          message: "Cloudinary prefix delete returned an invalid cursor",
          outcome: "uncertain",
        })
      );
}

function toPrefixDeleteError(error: CloudinaryRejectedValue) {
  const httpCode =
    typeof error === "object" && error !== null
      ? readCloudinaryHttpCode(error)
      : undefined;

  return new CloudinaryPrefixDeleteError({
    message: "Cloudinary asset prefix delete failed",
    outcome: httpCode !== undefined && httpCode < 500 ? "failed" : "uncertain",
    httpCode,
  });
}

function createPrefixDeleteExecutor() {
  const retryPolicy = createTransientRetryPolicy<CloudinaryPrefixDeleteError>(
    "asset prefix delete"
  );

  const deletePage = (prefix: CloudinaryPublicId, nextCursor?: string) =>
    Effect.tryPromise({
      try: () =>
        cloudinary.api.delete_resources_by_prefix(prefix, {
          resource_type: "image",
          type: "upload",
          ...(nextCursor === undefined ? {} : { next_cursor: nextCursor }),
        }),
      catch: (error) => toPrefixDeleteError(error as CloudinaryRejectedValue),
    }).pipe(
      Effect.flatMap(decodePrefixDeletePage),
      Effect.tapError((error) =>
        Effect.logError("Cloudinary asset prefix delete failed", {
          outcome: error.outcome,
        })
      ),
      Effect.retry(retryPolicy)
    );

  return Effect.fn("cloudinary.api.delete_resources_by_prefix")(
    function* (prefix: CloudinaryPublicId) {
      const seenCursors = new Set<string>();
      let nextCursor: string | undefined;

      for (
        let pageNumber = 0;
        pageNumber < prefixDeletePageLimit;
        pageNumber += 1
      ) {
        const page = yield* deletePage(prefix, nextCursor);
        yield* Effect.logInfo("Cloudinary asset prefix delete page completed", {
          pageNumber: pageNumber + 1,
        });

        if (page.nextCursor === undefined) return;
        if (seenCursors.has(page.nextCursor)) {
          return yield* new CloudinaryPrefixDeleteError({
            message: "Cloudinary prefix delete cursor repeated",
            outcome: "uncertain",
          });
        }

        seenCursors.add(page.nextCursor);
        nextCursor = page.nextCursor;
      }

      return yield* new CloudinaryPrefixDeleteError({
        message: "Cloudinary prefix delete exceeded its page limit",
        outcome: "uncertain",
      });
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
      // must never be logged. Only fixed operation messages and the
      // type-constrained overwrite flag are emitted.
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
        Effect.tap(() => Effect.logInfo("Cloudinary asset rename completed")),
        Effect.tapError((error) =>
          Effect.logError("Cloudinary asset rename failed", {
            reason: error.reason,
          })
        ),
        Effect.retry(renameRetryPolicy)
      );
    },
    (effect) => Effect.scoped(effect)
  );
}
