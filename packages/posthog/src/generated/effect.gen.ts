import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
// non-recursive definitions
export type FeatureFlagMultivariateVariantSchema = { readonly "key": string, readonly "name"?: string, readonly "rollout_percentage": number }
export const FeatureFlagMultivariateVariantSchema = Schema.Struct({ "key": Schema.String.annotate({ "description": "Unique key for this variant." }), "name": Schema.optionalKey(Schema.String.annotate({ "description": "Human-readable name for this variant." })), "rollout_percentage": Schema.Number.annotate({ "description": "Variant rollout percentage.", "format": "double" }).check(Schema.isFinite()) })
export type FeatureFlagFilterPropertyGenericSchema = { readonly "key": string, readonly "type"?: "cohort" | "person" | "group", readonly "cohort_name"?: string | null, readonly "group_type_index"?: number | null, readonly "value": Schema.Json, readonly "operator": "exact" | "is_not" | "icontains" | "not_icontains" | "regex" | "not_regex" | "gt" | "gte" | "lt" | "lte" }
export const FeatureFlagFilterPropertyGenericSchema = Schema.Struct({ "key": Schema.String.annotate({ "description": "Property key used in this feature flag condition." }), "type": Schema.optionalKey(Schema.Literals(["cohort", "person", "group"]).annotate({ "description": "* `cohort` - cohort\n* `person` - person\n* `group` - group" })), "cohort_name": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null], { mode: "oneOf" }).annotate({ "description": "Resolved cohort name for cohort-type filters." })), "group_type_index": Schema.optionalKey(Schema.Union([Schema.Number.check(Schema.isInt()), Schema.Null], { mode: "oneOf" }).annotate({ "description": "Group type index when using group-based filters." })), "value": Schema.Json.annotate({ "description": "Comparison value for the property filter. Supports strings, numbers, booleans, and arrays." }), "operator": Schema.Literals(["exact", "is_not", "icontains", "not_icontains", "regex", "not_regex", "gt", "gte", "lt", "lte"]).annotate({ "description": "* `exact` - exact\n* `is_not` - is_not\n* `icontains` - icontains\n* `not_icontains` - not_icontains\n* `regex` - regex\n* `not_regex` - not_regex\n* `gt` - gt\n* `gte` - gte\n* `lt` - lt\n* `lte` - lte" }) })
export type FeatureFlagFilterPropertyExistsSchema = { readonly "key": string, readonly "type"?: "cohort" | "person" | "group", readonly "cohort_name"?: string | null, readonly "group_type_index"?: number | null, readonly "operator": "is_set" | "is_not_set", readonly "value"?: Schema.Json }
export const FeatureFlagFilterPropertyExistsSchema = Schema.Struct({ "key": Schema.String.annotate({ "description": "Property key used in this feature flag condition." }), "type": Schema.optionalKey(Schema.Literals(["cohort", "person", "group"]).annotate({ "description": "* `cohort` - cohort\n* `person` - person\n* `group` - group" })), "cohort_name": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null], { mode: "oneOf" }).annotate({ "description": "Resolved cohort name for cohort-type filters." })), "group_type_index": Schema.optionalKey(Schema.Union([Schema.Number.check(Schema.isInt()), Schema.Null], { mode: "oneOf" }).annotate({ "description": "Group type index when using group-based filters." })), "operator": Schema.Literals(["is_set", "is_not_set"]).annotate({ "description": "* `is_set` - is_set\n* `is_not_set` - is_not_set" }), "value": Schema.optionalKey(Schema.Json.annotate({ "description": "Optional value. Runtime behavior determines whether this is ignored." })) })
export type FeatureFlagFilterPropertyDateSchema = { readonly "key": string, readonly "type"?: "cohort" | "person" | "group", readonly "cohort_name"?: string | null, readonly "group_type_index"?: number | null, readonly "operator": "is_date_exact" | "is_date_before" | "is_date_after", readonly "value": string }
export const FeatureFlagFilterPropertyDateSchema = Schema.Struct({ "key": Schema.String.annotate({ "description": "Property key used in this feature flag condition." }), "type": Schema.optionalKey(Schema.Literals(["cohort", "person", "group"]).annotate({ "description": "* `cohort` - cohort\n* `person` - person\n* `group` - group" })), "cohort_name": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null], { mode: "oneOf" }).annotate({ "description": "Resolved cohort name for cohort-type filters." })), "group_type_index": Schema.optionalKey(Schema.Union([Schema.Number.check(Schema.isInt()), Schema.Null], { mode: "oneOf" }).annotate({ "description": "Group type index when using group-based filters." })), "operator": Schema.Literals(["is_date_exact", "is_date_before", "is_date_after"]).annotate({ "description": "* `is_date_exact` - is_date_exact\n* `is_date_before` - is_date_before\n* `is_date_after` - is_date_after" }), "value": Schema.String.annotate({ "description": "Date value in ISO format or relative date expression." }) })
export type FeatureFlagFilterPropertySemverSchema = { readonly "key": string, readonly "type"?: "cohort" | "person" | "group", readonly "cohort_name"?: string | null, readonly "group_type_index"?: number | null, readonly "operator": "semver_gt" | "semver_gte" | "semver_lt" | "semver_lte" | "semver_eq" | "semver_neq" | "semver_tilde" | "semver_caret" | "semver_wildcard", readonly "value": string }
export const FeatureFlagFilterPropertySemverSchema = Schema.Struct({ "key": Schema.String.annotate({ "description": "Property key used in this feature flag condition." }), "type": Schema.optionalKey(Schema.Literals(["cohort", "person", "group"]).annotate({ "description": "* `cohort` - cohort\n* `person` - person\n* `group` - group" })), "cohort_name": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null], { mode: "oneOf" }).annotate({ "description": "Resolved cohort name for cohort-type filters." })), "group_type_index": Schema.optionalKey(Schema.Union([Schema.Number.check(Schema.isInt()), Schema.Null], { mode: "oneOf" }).annotate({ "description": "Group type index when using group-based filters." })), "operator": Schema.Literals(["semver_gt", "semver_gte", "semver_lt", "semver_lte", "semver_eq", "semver_neq", "semver_tilde", "semver_caret", "semver_wildcard"]).annotate({ "description": "* `semver_gt` - semver_gt\n* `semver_gte` - semver_gte\n* `semver_lt` - semver_lt\n* `semver_lte` - semver_lte\n* `semver_eq` - semver_eq\n* `semver_neq` - semver_neq\n* `semver_tilde` - semver_tilde\n* `semver_caret` - semver_caret\n* `semver_wildcard` - semver_wildcard" }), "value": Schema.String.annotate({ "description": "Semantic version string." }) })
export type FeatureFlagFilterPropertyMultiContainsSchema = { readonly "key": string, readonly "type"?: "cohort" | "person" | "group", readonly "cohort_name"?: string | null, readonly "group_type_index"?: number | null, readonly "operator": "icontains_multi" | "not_icontains_multi", readonly "value": ReadonlyArray<string> }
export const FeatureFlagFilterPropertyMultiContainsSchema = Schema.Struct({ "key": Schema.String.annotate({ "description": "Property key used in this feature flag condition." }), "type": Schema.optionalKey(Schema.Literals(["cohort", "person", "group"]).annotate({ "description": "* `cohort` - cohort\n* `person` - person\n* `group` - group" })), "cohort_name": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null], { mode: "oneOf" }).annotate({ "description": "Resolved cohort name for cohort-type filters." })), "group_type_index": Schema.optionalKey(Schema.Union([Schema.Number.check(Schema.isInt()), Schema.Null], { mode: "oneOf" }).annotate({ "description": "Group type index when using group-based filters." })), "operator": Schema.Literals(["icontains_multi", "not_icontains_multi"]).annotate({ "description": "* `icontains_multi` - icontains_multi\n* `not_icontains_multi` - not_icontains_multi" }), "value": Schema.Array(Schema.String).annotate({ "description": "List of strings to evaluate against." }) })
export type FeatureFlagFilterPropertyCohortInSchema = { readonly "key": string, readonly "type": "cohort", readonly "cohort_name"?: string | null, readonly "group_type_index"?: number | null, readonly "operator": "in" | "not_in", readonly "value": Schema.Json }
export const FeatureFlagFilterPropertyCohortInSchema = Schema.Struct({ "key": Schema.String.annotate({ "description": "Property key used in this feature flag condition." }), "type": Schema.Literal("cohort").annotate({ "description": "* `cohort` - cohort" }), "cohort_name": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null], { mode: "oneOf" }).annotate({ "description": "Resolved cohort name for cohort-type filters." })), "group_type_index": Schema.optionalKey(Schema.Union([Schema.Number.check(Schema.isInt()), Schema.Null], { mode: "oneOf" }).annotate({ "description": "Group type index when using group-based filters." })), "operator": Schema.Literals(["in", "not_in"]).annotate({ "description": "* `in` - in\n* `not_in` - not_in" }), "value": Schema.Json.annotate({ "description": "Cohort comparison value (single or list, depending on usage)." }) })
export type FeatureFlagFilterPropertyFlagEvaluatesSchema = { readonly "key": string, readonly "type": "flag", readonly "cohort_name"?: string | null, readonly "group_type_index"?: number | null, readonly "operator": "flag_evaluates_to", readonly "value": Schema.Json }
export const FeatureFlagFilterPropertyFlagEvaluatesSchema = Schema.Struct({ "key": Schema.String.annotate({ "description": "Property key used in this feature flag condition." }), "type": Schema.Literal("flag").annotate({ "description": "* `flag` - flag" }), "cohort_name": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null], { mode: "oneOf" }).annotate({ "description": "Resolved cohort name for cohort-type filters." })), "group_type_index": Schema.optionalKey(Schema.Union([Schema.Number.check(Schema.isInt()), Schema.Null], { mode: "oneOf" }).annotate({ "description": "Group type index when using group-based filters." })), "operator": Schema.Literal("flag_evaluates_to").annotate({ "description": "* `flag_evaluates_to` - flag_evaluates_to" }), "value": Schema.Json.annotate({ "description": "Value to compare flag evaluation against." }) })
export type FeatureFlagMultivariateSchema = { readonly "variants": ReadonlyArray<FeatureFlagMultivariateVariantSchema> }
export const FeatureFlagMultivariateSchema = Schema.Struct({ "variants": Schema.Array(FeatureFlagMultivariateVariantSchema).annotate({ "description": "Variant definitions for multivariate feature flags." }) })
export type FeatureFlagFilterPropertySchema = FeatureFlagFilterPropertyGenericSchema | FeatureFlagFilterPropertyExistsSchema | FeatureFlagFilterPropertyDateSchema | FeatureFlagFilterPropertySemverSchema | FeatureFlagFilterPropertyMultiContainsSchema | FeatureFlagFilterPropertyCohortInSchema | FeatureFlagFilterPropertyFlagEvaluatesSchema
export const FeatureFlagFilterPropertySchema = Schema.Union([FeatureFlagFilterPropertyGenericSchema, FeatureFlagFilterPropertyExistsSchema, FeatureFlagFilterPropertyDateSchema, FeatureFlagFilterPropertySemverSchema, FeatureFlagFilterPropertyMultiContainsSchema, FeatureFlagFilterPropertyCohortInSchema, FeatureFlagFilterPropertyFlagEvaluatesSchema], { mode: "oneOf" })
export type FeatureFlagConditionGroupSchema = { readonly "properties"?: ReadonlyArray<FeatureFlagFilterPropertySchema>, readonly "rollout_percentage"?: number, readonly "variant"?: string | null, readonly "aggregation_group_type_index"?: number | null }
export const FeatureFlagConditionGroupSchema = Schema.Struct({ "properties": Schema.optionalKey(Schema.Array(FeatureFlagFilterPropertySchema).annotate({ "description": "Property conditions for this release condition group." })), "rollout_percentage": Schema.optionalKey(Schema.Number.annotate({ "description": "Rollout percentage for this release condition group.", "format": "double" }).check(Schema.isFinite())), "variant": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null], { mode: "oneOf" }).annotate({ "description": "Variant key override for multivariate flags." })), "aggregation_group_type_index": Schema.optionalKey(Schema.Union([Schema.Number.check(Schema.isInt()), Schema.Null], { mode: "oneOf" }).annotate({ "description": "Group type index for this condition set. None means person-level aggregation." })) })
export type FeatureFlagFiltersSchema = { readonly "groups"?: ReadonlyArray<FeatureFlagConditionGroupSchema>, readonly "multivariate"?: FeatureFlagMultivariateSchema | null, readonly "aggregation_group_type_index"?: number | null, readonly "payloads"?: { readonly [x: string]: string }, readonly "feature_enrollment"?: boolean | null, readonly "early_exit"?: boolean }
export const FeatureFlagFiltersSchema = Schema.Struct({ "groups": Schema.optionalKey(Schema.Array(FeatureFlagConditionGroupSchema).annotate({ "description": "Release condition groups for the feature flag." })), "multivariate": Schema.optionalKey(Schema.Union([FeatureFlagMultivariateSchema, Schema.Null], { mode: "oneOf" }).annotate({ "description": "Multivariate configuration for variant-based rollouts." })), "aggregation_group_type_index": Schema.optionalKey(Schema.Union([Schema.Number.check(Schema.isInt()), Schema.Null], { mode: "oneOf" }).annotate({ "description": "Group type index for group-based feature flags." })), "payloads": Schema.optionalKey(Schema.Record(Schema.String, Schema.String).annotate({ "description": "Optional payload values keyed by variant key." })), "feature_enrollment": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null], { mode: "oneOf" }).annotate({ "description": "Whether this flag has early access feature enrollment enabled. When true, the flag is evaluated against the person property $feature_enrollment/{flag_key}." })), "early_exit": Schema.optionalKey(Schema.Boolean.annotate({ "description": "When true, condition evaluation stops at the first matching condition set rather than continuing to evaluate subsequent groups.", "default": false })) })
export type PostHogFeatureFlagListItem = { readonly "archived"?: boolean, readonly "deleted"?: boolean, readonly "filters"?: FeatureFlagFiltersSchema, readonly "key": string }
export const PostHogFeatureFlagListItem = Schema.Struct({ "archived": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Whether the flag is archived. Archived flags are hidden from the flag list by default and must be disabled (`active: false`)." })), "deleted": Schema.optionalKey(Schema.Boolean), "filters": Schema.optionalKey(FeatureFlagFiltersSchema), "key": Schema.String.check(Schema.isMaxLength(400)) })
export type PostHogFeatureFlagListPage = { readonly "count": number, readonly "next"?: string | null, readonly "previous"?: string | null, readonly "results": ReadonlyArray<PostHogFeatureFlagListItem> }
export const PostHogFeatureFlagListPage = Schema.Struct({ "count": Schema.Number.check(Schema.isInt()), "next": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "uri" }), Schema.Null], { mode: "oneOf" })), "previous": Schema.optionalKey(Schema.Union([Schema.String.annotate({ "format": "uri" }), Schema.Null], { mode: "oneOf" })), "results": Schema.Array(PostHogFeatureFlagListItem) })
// schemas
export type FeatureFlagsListParams = { readonly "active"?: "STALE" | "false" | "true", readonly "archived"?: "false" | "true", readonly "created_by_id"?: string, readonly "evaluation_runtime"?: "all" | "client" | "server", readonly "excluded_properties"?: string, readonly "excluded_tags"?: string, readonly "has_evaluation_contexts"?: "false" | "true", readonly "limit"?: number, readonly "offset"?: number, readonly "search"?: string, readonly "tags"?: string, readonly "type"?: "boolean" | "experiment" | "multivariant" | "remote_config" }
export const FeatureFlagsListParams = Schema.Struct({ "active": Schema.optionalKey(Schema.Literals(["STALE", "false", "true"])), "archived": Schema.optionalKey(Schema.Literals(["false", "true"])), "created_by_id": Schema.optionalKey(Schema.String), "evaluation_runtime": Schema.optionalKey(Schema.Literals(["all", "client", "server"])), "excluded_properties": Schema.optionalKey(Schema.String), "excluded_tags": Schema.optionalKey(Schema.String), "has_evaluation_contexts": Schema.optionalKey(Schema.Literals(["false", "true"])), "limit": Schema.optionalKey(Schema.Number.check(Schema.isInt())), "offset": Schema.optionalKey(Schema.Number.check(Schema.isInt())), "search": Schema.optionalKey(Schema.String), "tags": Schema.optionalKey(Schema.String), "type": Schema.optionalKey(Schema.Literals(["boolean", "experiment", "multivariant", "remote_config"])) })
export type FeatureFlagsList200 = PostHogFeatureFlagListPage
export const FeatureFlagsList200 = PostHogFeatureFlagListPage

export interface OperationConfig {
  /**
   * Whether or not the response should be included in the value returned from
   * an operation.
   *
   * If set to `true`, a tuple of `[A, HttpClientResponse]` will be returned,
   * where `A` is the success type of the operation.
   *
   * If set to `false`, only the success type of the operation will be returned.
   */
  readonly includeResponse?: boolean | undefined
}

/**
 * A utility type which optionally includes the response in the return result
 * of an operation based upon the value of the `includeResponse` configuration
 * option.
 */
export type WithOptionalResponse<A, Config extends OperationConfig> = Config extends {
  readonly includeResponse: true
} ? [A, HttpClientResponse.HttpClientResponse] : A

export const make = (
  httpClient: HttpClient.HttpClient,
  options: {
    readonly transformClient?: ((client: HttpClient.HttpClient) => Effect.Effect<HttpClient.HttpClient>) | undefined
  } = {}
): PostHogClient => {
  const unexpectedStatus = (response: HttpClientResponse.HttpClientResponse) =>
    Effect.flatMap(
      Effect.orElseSucceed(response.json, () => "Unexpected status code"),
      (description) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.StatusCodeError({
              request: response.request,
              response,
              description: typeof description === "string" ? description : JSON.stringify(description),
            }),
          }),
        ),
    )
  const withResponse = <Config extends OperationConfig>(config: Config | undefined) => (
    f: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<any, any>,
  ): (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<any, any> => {
    const withOptionalResponse = (
      config?.includeResponse
        ? (response: HttpClientResponse.HttpClientResponse) => Effect.map(f(response), (a) => [a, response])
        : (response: HttpClientResponse.HttpClientResponse) => f(response)
    ) as any
    return options?.transformClient
      ? (request) =>
          Effect.flatMap(
            Effect.flatMap(options.transformClient!(httpClient), (client) => client.execute(request)),
            withOptionalResponse
          )
      : (request) => Effect.flatMap(httpClient.execute(request), withOptionalResponse)
  }
  const decodeSuccess =
    <Schema extends Schema.Top>(schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      HttpClientResponse.schemaBodyJson(schema)(response)
  const decodeError =
    <const Tag extends string, Schema extends Schema.Top>(tag: Tag, schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(schema)(response),
        (cause) => Effect.fail(PostHogClientError(tag, cause, response)),
      )
  return {
    httpClient,
    "featureFlagsList": (projectId, options) => HttpClientRequest.get(`/api/projects/${projectId}/feature_flags/`).pipe(
    HttpClientRequest.setUrlParams({ "active": options?.params?.["active"] as any, "archived": options?.params?.["archived"] as any, "created_by_id": options?.params?.["created_by_id"] as any, "evaluation_runtime": options?.params?.["evaluation_runtime"] as any, "excluded_properties": options?.params?.["excluded_properties"] as any, "excluded_tags": options?.params?.["excluded_tags"] as any, "has_evaluation_contexts": options?.params?.["has_evaluation_contexts"] as any, "limit": options?.params?.["limit"] as any, "offset": options?.params?.["offset"] as any, "search": options?.params?.["search"] as any, "tags": options?.params?.["tags"] as any, "type": options?.params?.["type"] as any }),
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(FeatureFlagsList200),
      orElse: unexpectedStatus
    }))
  )
  }
}

export interface PostHogClient {
  readonly httpClient: HttpClient.HttpClient
  /**
* Create, read, update and delete feature flags. [See docs](https://posthog.com/docs/feature-flags) for more information on feature flags.
*
* If you're looking to use feature flags on your application, you can either use our JavaScript Library or our dedicated endpoint to check if feature flags are enabled for a given user.
*/
readonly "featureFlagsList": <Config extends OperationConfig>(projectId: string, options: { readonly params?: typeof FeatureFlagsListParams.Encoded | undefined; readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof FeatureFlagsList200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
}

export interface PostHogClientError<Tag extends string, E> {
  readonly _tag: Tag
  readonly request: HttpClientRequest.HttpClientRequest
  readonly response: HttpClientResponse.HttpClientResponse
  readonly cause: E
}

class PostHogClientErrorImpl extends Data.Error<{
  _tag: string
  cause: any
  request: HttpClientRequest.HttpClientRequest
  response: HttpClientResponse.HttpClientResponse
}> {}

export const PostHogClientError = <Tag extends string, E>(
  tag: Tag,
  cause: E,
  response: HttpClientResponse.HttpClientResponse,
): PostHogClientError<Tag, E> =>
  new PostHogClientErrorImpl({
    _tag: tag,
    cause,
    response,
    request: response.request,
  }) as any
