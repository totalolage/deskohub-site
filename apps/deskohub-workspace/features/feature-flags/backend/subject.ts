import "server-only";

import type { PostHogFeatureFlagSubject } from "@deskohub/posthog/feature-flags/node";
import { PostHogDistinctId } from "@deskohub/posthog/identifiers";
import { Effect, Option } from "effect";
import {
  readVisitorIdentity,
  type VisitorIdentity,
} from "@/shared/backend/analytics/visitor-identity";
import {
  CurrentVisitorIdentity,
  CurrentWorkspaceRequestHeaders,
  currentRequestHeaders,
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
   * across its runs: the headers its boundary captured, else Next's request
   * headers. None for a run outside any request, such as a task.
   */
  readonly request: WeakKey | undefined;
}

/**
 * The consented visitor of the request being served, or a non-recording
 * global subject for an anonymous visitor or a run outside any request.
 */
export const getCurrentFeatureFlagAudience = Effect.fn(
  "getCurrentFeatureFlagAudience"
)(() =>
  Effect.all([CurrentVisitorIdentity, CurrentWorkspaceRequestHeaders]).pipe(
    Effect.flatMap(([resolvedVisitor, capturedHeaders]) =>
      Option.match(resolvedVisitor, {
        onSome: (visitor) =>
          Effect.succeed(audienceOf(visitor, capturedHeaders)),
        onNone: () =>
          currentRequestHeaders.pipe(
            Effect.flatMap((headers) =>
              readVisitorIdentity(headers).pipe(
                Effect.map((visitor) => audienceOf(visitor, headers))
              )
            )
          ),
      })
    ),
    Effect.catch((error) =>
      Effect.logWarning(error.message, { cause: error.cause }).pipe(
        Effect.as<FeatureFlagAudience>({
          subject: workspaceReleaseSubject,
          request: undefined,
        })
      )
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
