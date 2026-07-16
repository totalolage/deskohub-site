import "server-only";

import type { PostHogFeatureFlagSubject } from "@deskohub/posthog/feature-flags/node";
import { Data, Effect } from "effect";
import { headers as getNextHeaders } from "next/headers";
import {
  getPostHogRequestContextFromRequestHeadersWithDiagnostics,
  logUnexpectedConsentCookieReasons,
  type PostHogRequestContext,
} from "@/shared/backend/analytics/posthog-request-context";

const globalReleaseSubject = {
  distinctId: "deskohub-workspace:global-release",
  sendFeatureFlagEvents: false,
} as const satisfies PostHogFeatureFlagSubject;

class PostHogFeatureFlagSubjectError extends Data.TaggedError(
  "PostHogFeatureFlagSubjectError"
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export const getCurrentPostHogFeatureFlagSubject = Effect.fn(
  "getCurrentPostHogFeatureFlagSubject"
)(() =>
  Effect.Do.pipe(
    Effect.bind("headers", loadNextHeaders),
    Effect.let("requestContext", ({ headers }) =>
      getPostHogRequestContextFromRequestHeadersWithDiagnostics(headers)
    ),
    Effect.tap(({ requestContext }) =>
      logUnexpectedConsentCookieReasons(
        requestContext.unexpectedConsentCookieReasons
      )
    ),
    Effect.map(({ requestContext }) =>
      getPostHogFeatureFlagSubject(requestContext.context)
    ),
    Effect.catch((error) =>
      Effect.logWarning(error.message, { cause: error.cause }).pipe(
        Effect.as(globalReleaseSubject)
      )
    )
  )
);

export function getPostHogFeatureFlagSubjectFromRequestHeaders(
  headers: Headers
): PostHogFeatureFlagSubject {
  return getPostHogFeatureFlagSubject(
    getPostHogRequestContextFromRequestHeadersWithDiagnostics(headers).context
  );
}

const loadNextHeaders = Effect.fn("loadNextHeaders")(() =>
  Effect.tryPromise({
    try: () => getNextHeaders(),
    catch: (cause) =>
      new PostHogFeatureFlagSubjectError({
        message: "Could not load the PostHog feature flag request subject.",
        cause,
      }),
  })
);

function getPostHogFeatureFlagSubject({
  distinctId,
}: PostHogRequestContext): PostHogFeatureFlagSubject {
  return distinctId
    ? { distinctId, sendFeatureFlagEvents: true }
    : globalReleaseSubject;
}
