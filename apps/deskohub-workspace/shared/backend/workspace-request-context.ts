import { Effect } from "effect";
import {
  CurrentPostHogRequestContext,
  getPostHogRequestContextFromRequestHeadersWithDiagnostics,
  logUnexpectedConsentCookieReasons,
} from "./analytics/posthog-request-context";
import { getPostHogLogAnnotationsFromCookieValues } from "./logging/posthog-log-annotations";

export const withWorkspaceRequestContext = (headers: Headers) =>
  function provideWorkspaceRequestContext<A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) {
    return Effect.sync(() =>
      getPostHogRequestContextFromRequestHeadersWithDiagnostics(headers)
    ).pipe(
      Effect.flatMap(({ context, unexpectedConsentCookieReasons }) =>
        Effect.andThen(
          logUnexpectedConsentCookieReasons(unexpectedConsentCookieReasons),
          effect
        ).pipe(
          Effect.annotateLogs(
            getPostHogLogAnnotationsFromCookieValues(context)
          ),
          Effect.provideService(CurrentPostHogRequestContext, context)
        )
      )
    );
  };
