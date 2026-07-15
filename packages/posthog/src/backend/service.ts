import { Context, Effect, Layer, Redacted } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { PostHogConfig } from "../config";
import { PostHogRequestError } from "../errors";
import {
  make,
  type PostHogFeatureFlagListItem,
  type PostHogFeatureFlagListPage,
} from "../generated/effect.gen";

export interface ListPostHogFeatureFlagsInput {
  readonly archived?: "false" | "true";
  readonly limit?: number;
  readonly offset?: number;
  readonly projectId: string;
}

interface IPostHogService {
  readonly listFeatureFlags: (
    input: ListPostHogFeatureFlagsInput
  ) => Effect.Effect<PostHogFeatureFlagListPage, PostHogRequestError>;
}

type GeneratedClientError = {
  readonly response: { readonly status: number };
};

const makePostHogService = Effect.gen(function* () {
  const config = yield* PostHogConfig;
  const httpClient = yield* HttpClient.HttpClient;
  const authenticatedClient = httpClient.pipe(
    HttpClient.mapRequestInput((request) =>
      request.pipe(
        HttpClientRequest.prependUrl(config.host.origin),
        HttpClientRequest.setHeaders({
          Accept: "application/json",
          Authorization: `Bearer ${Redacted.value(config.apiKey)}`,
        })
      )
    )
  );
  const client = make(authenticatedClient);

  return {
    listFeatureFlags: ({ archived, limit, offset, projectId }) =>
      client
        .featureFlagsList(encodeURIComponent(projectId), {
          params: { archived, limit, offset },
        })
        .pipe(
          Effect.timeoutOrElse({
            duration: "10 seconds",
            orElse: () =>
              Effect.fail(
                new PostHogRequestError({
                  message:
                    "PostHog feature flag request timed out before a response was received.",
                })
              ),
          }),
          Effect.mapError(mapPostHogRequestError)
        ),
  } satisfies IPostHogService;
});

export class PostHogService extends Context.Service<
  PostHogService,
  IPostHogService
>()("@deskohub/posthog/PostHogService") {
  static Live = Layer.effect(this, makePostHogService);
  static Default = this.Live.pipe(
    Layer.provide(PostHogConfig.Live),
    Layer.provide(FetchHttpClient.layer)
  );
}

const mapPostHogRequestError = (error: unknown) => {
  if (error instanceof PostHogRequestError) return error;

  const statusCode = getStatusCode(error);
  return new PostHogRequestError({
    message:
      statusCode === undefined
        ? "PostHog feature flag response did not match the generated API contract."
        : `PostHog feature flag request failed with status ${statusCode}.`,
    ...(statusCode === undefined ? {} : { statusCode }),
  });
};

const getStatusCode = (error: unknown) => {
  if (HttpClientError.isHttpClientError(error)) return error.response?.status;
  if (isGeneratedClientError(error)) return error.response.status;
  return undefined;
};

const isGeneratedClientError = (
  error: unknown
): error is GeneratedClientError =>
  error !== null &&
  typeof error === "object" &&
  "response" in error &&
  error.response !== null &&
  typeof error.response === "object" &&
  "status" in error.response &&
  typeof error.response.status === "number";

export type FeatureFlag = PostHogFeatureFlagListItem;
