import { Context, Effect, Layer, Schema } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import type { FeatureFlag } from "../generated/effect.gen";
import { PostHogFeatureFlagConfig } from "./config";
import { PostHogFeatureFlagError } from "./errors";

const pageSize = 100;

const FeatureFlagFilters = Schema.Struct({
  multivariate: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({
        variants: Schema.Array(Schema.Struct({ key: Schema.String })),
      }),
      Schema.Null,
    ])
  ),
  payloads: Schema.optionalKey(
    Schema.Union([Schema.Record(Schema.String, Schema.Json), Schema.Null])
  ),
});

const FeatureFlagSummarySchema = Schema.Struct({
  archived: Schema.optionalKey(Schema.Boolean),
  deleted: Schema.optionalKey(Schema.Boolean),
  filters: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  key: Schema.String,
});

// PostHog's live feature-flag list response currently disagrees with its
// OpenAPI schema on nullable pagination and nested user fields. Decode only the
// generated FeatureFlag fields needed by type generation until the spec is
// corrected, rather than weakening the generated client globally.
const FeatureFlagPage = Schema.Struct({
  count: Schema.Number,
  next: Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])),
  previous: Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])),
  results: Schema.Array(FeatureFlagSummarySchema),
});

type FeatureFlagSummary = Pick<
  FeatureFlag,
  "archived" | "deleted" | "filters" | "key"
>;

export interface PostHogFeatureFlagDefinition {
  readonly key: string;
  readonly payloads: Readonly<Record<string, Schema.Json>>;
  readonly variants: readonly string[];
}

export type PostHogFeatureFlagPageSource = (input: {
  readonly limit: number;
  readonly offset: number;
  readonly projectId: string;
}) => Effect.Effect<
  {
    readonly count: number;
    readonly results: readonly FeatureFlagSummary[];
  },
  unknown
>;

interface IPostHogFeatureFlagService {
  readonly listDefinitions: () => Effect.Effect<
    readonly PostHogFeatureFlagDefinition[],
    PostHogFeatureFlagError
  >;
}

export class PostHogFeatureFlagService extends Context.Service<
  PostHogFeatureFlagService,
  IPostHogFeatureFlagService
>()("@deskohub/posthog/PostHogFeatureFlagService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* PostHogFeatureFlagConfig;
      const httpClient = yield* HttpClient.HttpClient;
      const authenticatedClient = httpClient.pipe(
        HttpClient.mapRequestInput((request) =>
          request.pipe(
            HttpClientRequest.prependUrl(config.host.origin),
            HttpClientRequest.setHeader(
              "Authorization",
              `Bearer ${config.apiKey}`
            )
          )
        )
      );

      return {
        listDefinitions: () =>
          listPostHogFeatureFlagDefinitions(
            config.projectId,
            ({ limit, offset, projectId }) =>
              HttpClientRequest.get(
                `/api/projects/${encodeURIComponent(projectId)}/feature_flags/`
              ).pipe(
                HttpClientRequest.setUrlParams({
                  archived: "false",
                  limit,
                  offset,
                }),
                authenticatedClient.execute,
                Effect.flatMap(HttpClientResponse.filterStatusOk),
                Effect.flatMap(
                  HttpClientResponse.schemaBodyJson(FeatureFlagPage)
                )
              )
          ),
      } satisfies IPostHogFeatureFlagService;
    })
  );
}

export const listPostHogFeatureFlagDefinitions = (
  projectId: string,
  listPage: PostHogFeatureFlagPageSource
) =>
  Effect.gen(function* () {
    const definitions = new Map<string, PostHogFeatureFlagDefinition>();

    for (let offset = 0; ; offset += pageSize) {
      const page = yield* listPage({
        limit: pageSize,
        offset,
        projectId,
      }).pipe(
        Effect.mapError(
          () =>
            new PostHogFeatureFlagError({
              message: "Could not list PostHog feature flags.",
            })
        )
      );

      for (const featureFlag of page.results) {
        if (featureFlag.archived || featureFlag.deleted) continue;

        const definition = yield* toPostHogFeatureFlagDefinition(featureFlag);
        if (definitions.has(definition.key)) {
          return yield* new PostHogFeatureFlagError({
            message:
              "PostHog returned the same feature flag key more than once.",
          });
        }
        definitions.set(definition.key, definition);
      }

      if (
        page.results.length < pageSize ||
        offset + page.results.length >= page.count
      ) {
        return [...definitions.values()].toSorted((left, right) =>
          left.key.localeCompare(right.key)
        );
      }
    }
  });

const toPostHogFeatureFlagDefinition = (featureFlag: FeatureFlagSummary) =>
  Effect.gen(function* () {
    const key = featureFlag.key.trim();
    if (!key) {
      return yield* new PostHogFeatureFlagError({
        message: "PostHog returned a feature flag with a blank key.",
      });
    }

    const filters = yield* Schema.decodeUnknownEffect(FeatureFlagFilters)(
      featureFlag.filters ?? {}
    ).pipe(
      Effect.mapError(
        () =>
          new PostHogFeatureFlagError({
            message: `PostHog returned invalid filters for feature flag ${JSON.stringify(key)}.`,
          })
      )
    );

    return {
      key,
      payloads: filters.payloads ?? {},
      variants: [
        ...new Set(
          (filters.multivariate?.variants ?? [])
            .map((variant) => variant.key.trim())
            .filter(Boolean)
        ),
      ].toSorted((left, right) => left.localeCompare(right)),
    } satisfies PostHogFeatureFlagDefinition;
  });
