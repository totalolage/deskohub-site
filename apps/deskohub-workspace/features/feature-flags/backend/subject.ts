import "server-only";

import type { PostHogFeatureFlagSubject } from "@deskohub/posthog/feature-flags/node";
import { Effect } from "effect";
import {
  getPostHogRequestContextFromRequestHeadersWithDiagnostics,
  logUnexpectedConsentCookieReasons,
  type PostHogRequestContext,
} from "@/shared/backend/analytics/posthog-request-context";
import { getRequestHeaders } from "@/shared/backend/utils/request-headers";

const globalReleaseSubject = {
  distinctId: "deskohub-workspace:global-release",
  sendFeatureFlagEvents: false,
} as const satisfies PostHogFeatureFlagSubject;

export const getCurrentPostHogFeatureFlagSubject = Effect.fn(
  "getCurrentPostHogFeatureFlagSubject"
)(() =>
  Effect.Do.pipe(
    Effect.bind("headers", getRequestHeaders),
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

function getPostHogFeatureFlagSubject({
  distinctId,
}: PostHogRequestContext): PostHogFeatureFlagSubject {
  return distinctId
    ? { distinctId, sendFeatureFlagEvents: true }
    : globalReleaseSubject;
}
