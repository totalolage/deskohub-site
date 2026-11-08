import type { Redacted } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { make, type PostHogClient } from "./generated/effect.gen";

/** Where the PostHog management API lives and the personal API key that authenticates it. */
export interface PostHogManagementCredentials {
  /** The private API host, such as `https://eu.posthog.com`. */
  readonly host: URL;
  readonly apiKey: Redacted.Redacted<string>;
}

/** The generated PostHog management API client, authenticated with a personal API key against `host`. */
export const makePostHogManagementClient = (
  httpClient: HttpClient.HttpClient,
  { apiKey, host }: PostHogManagementCredentials
): PostHogClient =>
  make(
    httpClient.pipe(
      HttpClient.mapRequestInput((request) =>
        request.pipe(
          HttpClientRequest.prependUrl(host.origin),
          HttpClientRequest.bearerToken(apiKey)
        )
      )
    )
  );
