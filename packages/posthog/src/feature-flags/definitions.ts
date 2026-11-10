import { Context, Effect, Layer, Predicate, Redacted, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
} from "effect/unstable/http";
import type { FeatureFlag } from "../generated/effect.gen";
import type { PostHogProjectId } from "../identifiers";
import { makePostHogManagementClient } from "../management-client";
import {
  PostHogFeatureFlagConfig,
  type PostHogFeatureFlagConfigInput,
} from "./config";
import { PostHogFeatureFlagError } from "./errors";

const pageSize = 100;
const pageRequestTimeout = "10 seconds";

const FeatureFlagFilters = Schema.Struct({
  aggregation_group_type_index: Schema.optionalKey(
    Schema.Union([Schema.Number, Schema.Null])
  ),
  early_exit: Schema.optionalKey(Schema.Boolean),
  groups: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        aggregation_group_type_index: Schema.optionalKey(
          Schema.Union([Schema.Number, Schema.Null])
        ),
        properties: Schema.optionalKey(Schema.Array(Schema.Unknown)),
        rollout_percentage: Schema.optionalKey(Schema.Number),
      })
    )
  ),
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

type FeatureFlagSummary = Pick<
  FeatureFlag,
  | "active"
  | "archived"
  | "deleted"
  | "ensure_experience_continuity"
  | "filters"
  | "key"
>;

export interface PostHogFeatureFlagDefinition {
  readonly constantEnabledValue?: boolean;
  readonly key: string;
  readonly payloads: Readonly<Record<string, Schema.Json>>;
  readonly variants: readonly string[];
}

export type PostHogFeatureFlagPageSource = (input: {
  readonly limit: number;
  readonly offset: number;
  readonly projectId: PostHogProjectId;
}) => Effect.Effect<
  {
    readonly count: number;
    readonly results: readonly FeatureFlagSummary[];
  },
  unknown
>;

interface IPostHogFeatureFlagService {
  readonly listDefinitions: Effect.Effect<
    readonly PostHogFeatureFlagDefinition[],
    PostHogFeatureFlagError
  >;
}

export class PostHogFeatureFlagService extends Context.Service<
  PostHogFeatureFlagService,
  IPostHogFeatureFlagService
>()("@deskohub/posthog/PostHogFeatureFlagService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* PostHogFeatureFlagConfig;
      const httpClient = yield* HttpClient.HttpClient;
      const client = makePostHogManagementClient(httpClient, {
        apiKey: Redacted.make(config.apiKey),
        host: config.host,
      });

      return {
        listDefinitions: listPostHogFeatureFlagDefinitions(
          config.projectId,
          ({ limit, offset, projectId }) =>
            client.featureFlagsList(projectId, {
              params: {
                archived: "false",
                limit,
                offset,
              },
            })
        ),
      } satisfies IPostHogFeatureFlagService;
    })
  );

  static Live = (input: PostHogFeatureFlagConfigInput) =>
    this.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          PostHogFeatureFlagConfig.from(input),
          FetchHttpClient.layer
        )
      )
    );
}

export const loadPostHogFeatureFlagDefinitions = Effect.fn(
  function* (_input: PostHogFeatureFlagConfigInput) {
    const featureFlagService = yield* PostHogFeatureFlagService;
    return yield* featureFlagService.listDefinitions;
  },
  (effect, input) =>
    effect.pipe(Effect.provide(PostHogFeatureFlagService.Live(input)))
);

export const listPostHogFeatureFlagDefinitions = (
  projectId: PostHogProjectId,
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
          (cause) =>
            new PostHogFeatureFlagError({
              message: "Could not list PostHog feature flags.",
              cause,
              ...describeListFailure(cause),
            })
        ),
        Effect.timeoutOrElse({
          duration: pageRequestTimeout,
          orElse: () =>
            Effect.fail(
              new PostHogFeatureFlagError({
                message: "PostHog feature flag request timed out.",
                failureCode: "Timeout",
              })
            ),
        })
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

/**
 * The status and failed step of a page request, which logs keep while they
 * redact the provider's error text.
 */
const describeListFailure = (
  cause: unknown
): Pick<PostHogFeatureFlagError, "failureCode" | "httpStatus"> => {
  if (!HttpClientError.isHttpClientError(cause)) {
    return Predicate.isTagged(cause, "SchemaError")
      ? { failureCode: "SchemaError" }
      : {};
  }

  const httpStatus = cause.response?.status;
  return {
    failureCode: cause.reason._tag,
    ...(httpStatus === undefined ? {} : { httpStatus }),
  };
};

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
      constantEnabledValue: getConstantEnabledValue(featureFlag, filters),
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

const getConstantEnabledValue = (
  featureFlag: FeatureFlagSummary,
  filters: FeatureFlagFilters
): boolean | undefined => {
  if (featureFlag.active === false) return false;
  if (
    featureFlag.active !== true ||
    featureFlag.ensure_experience_continuity === true
  ) {
    return undefined;
  }

  return getConstantReleaseValue(filters);
};

type FeatureFlagFilters = typeof FeatureFlagFilters.Type;
type FeatureFlagReleaseGroup = NonNullable<
  FeatureFlagFilters["groups"]
>[number];

/**
 * The value every person gets from an active flag's release conditions, when
 * the conditions alone settle it.
 */
const getConstantReleaseValue = (
  filters: FeatureFlagFilters
): boolean | undefined => {
  const groups = filters.groups ?? [];
  if (groups.length > 0 && groups.every(releasesToNobody)) return false;
  if (filters.aggregation_group_type_index != null) return undefined;
  if ((filters.multivariate?.variants.length ?? 0) > 0) return undefined;

  return getUnconditionalReleaseValue(groups, filters.early_exit === true);
};

/**
 * True when a group releasing to everyone is reached by every person: with
 * early exit, each earlier group must release to everyone it matches too.
 */
const getUnconditionalReleaseValue = (
  groups: readonly FeatureFlagReleaseGroup[],
  earlyExit: boolean
): true | undefined => {
  const unconditionalIndex = groups.findIndex(releasesToEveryone);
  if (unconditionalIndex < 0) return undefined;
  if (!earlyExit) return true;

  return groups.slice(0, unconditionalIndex).every(releasesToAllMatched)
    ? true
    : undefined;
};

const releasePercentage = (group: FeatureFlagReleaseGroup) =>
  group.rollout_percentage ?? 100;

const releasesToNobody = (group: FeatureFlagReleaseGroup) =>
  releasePercentage(group) <= 0;

const releasesToAllMatched = (group: FeatureFlagReleaseGroup) =>
  releasePercentage(group) >= 100;

const releasesToEveryone = (group: FeatureFlagReleaseGroup) =>
  group.aggregation_group_type_index == null &&
  (group.properties?.length ?? 0) === 0 &&
  releasesToAllMatched(group);

export { PostHogFeatureFlagError } from "./errors";

/** The log fields that classify a flag failure without its provider text. */
export const postHogFeatureFlagFailureLogFields = ({
  cause,
  failureCode,
  httpStatus,
}: PostHogFeatureFlagError) => ({ cause, failureCode, httpStatus });
