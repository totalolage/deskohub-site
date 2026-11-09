import "server-only";

import type { PostHogFeatureFlagSubject } from "@deskohub/posthog/feature-flags/node";
import { PostHogDistinctId } from "@deskohub/posthog/identifiers";
import { Effect, Option } from "effect";
import {
  readVisitorIdentity,
  type VisitorIdentity,
} from "@/shared/backend/analytics/visitor-identity";
import { getRequestHeaders } from "@/shared/backend/utils/request-headers";
import {
  CurrentVisitorIdentity,
  CurrentWorkspaceRequestHeaders,
} from "@/shared/backend/workspace-request-context";

/**
 * The non-recording subject of every anonymous visitor and of work that serves
 * no visitor. One distinct id for all of them, so its evaluation can be shared
 * across requests while no flag targets persons or groups.
 */
export const workspaceReleaseSubject = {
  distinctId: PostHogDistinctId.make("deskohub-workspace:global-release"),
  sendFeatureFlagEvents: false,
} as const satisfies PostHogFeatureFlagSubject;

/** Who flags are evaluated for, and for which request. */
export interface FeatureFlagAudience {
  readonly subject: PostHogFeatureFlagSubject;
  /**
   * The request being served, as an identity for sharing one evaluation
   * across its runs: Next's request headers, one object per request, else
   * the headers its boundary captured. None for a run outside any request,
   * such as a task.
   */
  readonly request: WeakKey | undefined;
}

/**
 * The consented visitor of the request being served, or a non-recording
 * global subject for an anonymous visitor or a run outside any request.
 */
export const getCurrentFeatureFlagAudience = Effect.fn(
  "getCurrentFeatureFlagAudience"
)(
  function* () {
    const resolvedVisitor = yield* CurrentVisitorIdentity;
    const capturedHeaders = yield* CurrentWorkspaceRequestHeaders;
    if (capturedHeaders === undefined) {
      if (Option.isSome(resolvedVisitor)) {
        // A boundary that captured no request, such as a task's.
        return audienceOf(resolvedVisitor.value, undefined);
      }
      const headers = yield* getRequestHeaders;
      return audienceOf(yield* readVisitorIdentity(headers), headers);
    }
    const visitor = Option.isSome(resolvedVisitor)
      ? resolvedVisitor.value
      : yield* readVisitorIdentity(capturedHeaders);
    // A route boundary captures its `Request`'s own headers, a different
    // object from Next's, which the request's other runs read.
    const request = yield* getRequestHeaders.pipe(
      Effect.orElseSucceed(() => capturedHeaders)
    );
    return audienceOf(visitor, request);
  },
  Effect.catch((error) =>
    Effect.logWarning(error.message, { cause: error.cause }).pipe(
      Effect.as<FeatureFlagAudience>({
        subject: workspaceReleaseSubject,
        request: undefined,
      })
    )
  )
);

const audienceOf = (
  { distinctId }: VisitorIdentity,
  request: WeakKey | undefined
): FeatureFlagAudience => ({
  subject: distinctId
    ? { distinctId, sendFeatureFlagEvents: true }
    : workspaceReleaseSubject,
  request,
});
