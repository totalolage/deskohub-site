import "server-only";

import { v2 as cloudinary } from "cloudinary";
import { Duration, Effect, Order, pipe } from "effect";
import * as Schema from "effect/Schema";
import {
  HttpClient,
  type HttpClientError,
  HttpClientResponse,
} from "effect/unstable/http";
import type { CloudinaryConfig } from "./config";
import { CloudinarySearchError } from "./errors";
import type { CnfExpression } from "./expression";
import { createTransientRetryPolicy } from "./retry";
import {
  type CloudinaryAsset,
  CloudinaryAssetSchema,
  CloudinaryPublicIdSchema,
  type SearchOptions,
  SearchOptionsSchema,
} from "./schema";

/**
 * One entry of a Cloudinary tag resource list
 * (`https://res.cloudinary.com/<cloud>/image/list/<tag>.json`). Unknown fields
 * such as structured `metadata` are dropped while decoding.
 */
const TagListEntrySchema = Schema.Struct({
  public_id: CloudinaryPublicIdSchema,
  version: Schema.optional(Schema.Finite),
  format: Schema.String,
  width: Schema.Finite,
  height: Schema.Finite,
  type: Schema.optional(Schema.String),
  created_at: Schema.String,
  context: CloudinaryAssetSchema.fields.context,
});

type TagListEntry = typeof TagListEntrySchema.Type;

const TagListSchema = Schema.Struct({
  resources: Schema.Array(TagListEntrySchema),
});

/**
 * Upper bound for one tag list request, body decoding included. A timed-out
 * request fails with the typed error; it is not retried because it carries no
 * 5xx code.
 */
const tagListRequestTimeout = Duration.seconds(5);

/**
 * Fixed, identifier-free failure values. Provider responses, the requested
 * tags, and above all the signed list URL never enter errors or logs: the URL
 * carries a signature derived from the API secret.
 */
const tagListExpressionLabel = "gallery tag list";
const tagListFailureMessage = "Cloudinary tag list request failed";

const toTagListError = (httpCode?: number) =>
  new CloudinarySearchError({
    message: tagListFailureMessage,
    expression: tagListExpressionLabel,
    httpCode,
  });

const tagListRetryPolicy =
  createTransientRetryPolicy<CloudinarySearchError>("tag list");

/**
 * Lists image assets matching a tag expression from Cloudinary's CDN-delivered
 * tag resource lists instead of the Admin Search API, so gallery renders and
 * cache revalidations never spend the hourly Admin API quota.
 *
 * The outer expression array is OR, each inner group is AND of its positive
 * tags, and `!tag` entries exclude assets carrying that tag. A group without
 * positive tags cannot be answered from tag lists and selects nothing. Sorting
 * and `maxResults` are applied after combining the lists; each list holds at
 * most 1000 assets and the CDN refreshes it at most once a minute.
 */
export function makeTaggedAssetLister(
  config: CloudinaryConfig,
  httpClient: HttpClient.HttpClient
) {
  // The list delivery type is restricted on the account, and a signed URL is
  // the documented way to bypass that restriction without opening it to
  // anonymous clients. The SDK signs the path locally with the API secret.
  const signTagListUrl = (tag: string) =>
    Effect.try({
      try: () =>
        cloudinary.url(tag, {
          resource_type: "image",
          type: "list",
          format: "json",
          sign_url: true,
          secure: true,
          cloud_name: config.cloudName,
          api_secret: config.apiSecret,
          urlAnalytics: false,
        }),
      catch: () => toTagListError(),
    });

  const fetchTagList = (tag: string) =>
    pipe(
      signTagListUrl(tag),
      Effect.flatMap((listUrl) => httpClient.get(listUrl)),
      Effect.flatMap(
        (
          response
        ): Effect.Effect<
          readonly TagListEntry[],
          | CloudinarySearchError
          | HttpClientError.HttpClientError
          | Schema.SchemaError
        > => {
          // Cloudinary answers 404 for a tag that no asset carries.
          if (response.status === 404) return Effect.succeed([]);
          if (response.status < 200 || response.status >= 300) {
            return Effect.fail(toTagListError(response.status));
          }

          return HttpClientResponse.schemaBodyJson(TagListSchema)(
            response
          ).pipe(Effect.map(({ resources }) => resources));
        }
      ),
      // Transport and decoding errors describe the signed request URL, so
      // they are replaced wholesale instead of being attached as a cause.
      Effect.mapError((error) =>
        error instanceof CloudinarySearchError ? error : toTagListError()
      ),
      Effect.timeoutOrElse({
        duration: tagListRequestTimeout,
        orElse: () => Effect.fail(toTagListError()),
      }),
      Effect.tapError(() => Effect.logError(tagListFailureMessage)),
      Effect.retry(tagListRetryPolicy),
      // Effect's client spans record the full request URL, signature
      // included. `CloudinaryService.Live` also suppresses OpenTelemetry fetch
      // and HTTP instrumentation spans for these requests.
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true)
    );

  const toAsset = (entry: TagListEntry): CloudinaryAsset => {
    const deliveryOptions = (secure: boolean) => ({
      resource_type: "image",
      type: entry.type ?? "upload",
      format: entry.format,
      secure,
      sign_url: false,
      cloud_name: config.cloudName,
      urlAnalytics: false,
      ...(entry.version === undefined
        ? {}
        : { version: String(entry.version) }),
    });

    return {
      public_id: entry.public_id,
      secure_url: cloudinary.url(entry.public_id, deliveryOptions(true)),
      url: cloudinary.url(entry.public_id, deliveryOptions(false)),
      width: entry.width,
      height: entry.height,
      format: entry.format,
      resource_type: "image",
      created_at: entry.created_at,
      ...(entry.version === undefined ? {} : { version: entry.version }),
      ...(entry.context === undefined ? {} : { context: entry.context }),
    };
  };

  return Effect.fn("CloudinaryService.listTaggedAssets")(function* <
    Tag extends string,
  >(expression: CnfExpression<Tag>, options?: SearchOptions) {
    const { maxResults, sortBy, sortDirection } = yield* pipe(
      Schema.decodeUnknownEffect(SearchOptionsSchema)(options ?? {}),
      Effect.mapError(
        () =>
          new CloudinarySearchError({
            message: "Cloudinary search options did not match the schema",
            expression: tagListExpressionLabel,
          })
      )
    );
    const groups = expression.flatMap(toTagGroup);
    const tags = [
      ...new Set(
        groups.flatMap(({ required, excluded }) => [...required, ...excluded])
      ),
    ];

    yield* Effect.logInfo("Cloudinary tag list lookup started", {
      tagCount: tags.length,
    });

    const lists = new Map(
      yield* Effect.forEach(
        tags,
        (tag) =>
          fetchTagList(tag).pipe(
            Effect.map((entries) => [tag, entries] as const)
          ),
        { concurrency: "inherit" }
      )
    );
    const entries = selectEntries(groups, lists).sort(
      orderEntries(sortBy ?? "created_at", sortDirection ?? "desc")
    );
    const assets = yield* Effect.try({
      try: () =>
        (maxResults === undefined ? entries : entries.slice(0, maxResults)).map(
          toAsset
        ),
      catch: () => toTagListError(),
    });

    yield* Effect.logInfo("Cloudinary tag list lookup completed", {
      resultCount: assets.length,
    });

    return assets;
  });
}

interface TagGroup {
  readonly required: readonly [string, ...string[]];
  readonly excluded: readonly string[];
}

function toTagGroup(group: readonly string[]): readonly TagGroup[] {
  const [first, ...rest] = new Set(group.filter((tag) => !tag.startsWith("!")));
  const excluded = [
    ...new Set(
      group.filter((tag) => tag.startsWith("!")).map((tag) => tag.slice(1))
    ),
  ];

  return first === undefined ? [] : [{ required: [first, ...rest], excluded }];
}

/**
 * Asset identity across lists. A tag list spans every delivery type, and the
 * same public ID may exist once per type.
 */
const entryKey = (entry: TagListEntry) =>
  `${entry.type ?? "upload"}/${entry.public_id}`;

function selectEntries(
  groups: readonly TagGroup[],
  lists: ReadonlyMap<string, readonly TagListEntry[]>
): TagListEntry[] {
  const listKeys = (tag: string) =>
    new Set((lists.get(tag) ?? []).map(entryKey));
  const selected = new Map<string, TagListEntry>();

  for (const { required, excluded } of groups) {
    const [first, ...rest] = required;
    const requiredKeys = rest.map(listKeys);
    const excludedKeys = new Set(excluded.flatMap((tag) => [...listKeys(tag)]));

    for (const entry of lists.get(first) ?? []) {
      const key = entryKey(entry);
      if (
        !selected.has(key) &&
        !excludedKeys.has(key) &&
        requiredKeys.every((keys) => keys.has(key))
      ) {
        selected.set(key, entry);
      }
    }
  }

  return [...selected.values()];
}

const byPublicId = Order.mapInput(
  Order.String,
  (entry: TagListEntry) => entry.public_id
);
const byCreationTime = Order.combine(
  Order.mapInput(Order.String, (entry: TagListEntry) => entry.created_at),
  byPublicId
);

/**
 * Tag lists carry no per-asset update time, so `updated_at` orders by
 * creation time. Cloudinary emits `created_at` as uniform UTC ISO strings, so
 * text order is chronological. Public IDs break ties for a stable order.
 */
function orderEntries(
  sortBy: NonNullable<SearchOptions["sortBy"]>,
  sortDirection: NonNullable<SearchOptions["sortDirection"]>
): Order.Order<TagListEntry> {
  const order = sortBy === "public_id" ? byPublicId : byCreationTime;

  return sortDirection === "asc" ? order : Order.flip(order);
}
