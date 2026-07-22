import { Effect } from "effect";
import {
  getPostHogLogAnnotationsFromRequestHeadersWithDiagnostics,
  logUnexpectedConsentCookieReasons,
} from "./logging/posthog-log-annotations";

export const withWorkspaceRequestContext = (headers: Headers) =>
  function provideWorkspaceRequestContext<A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) {
    return Effect.sync(() =>
      getPostHogLogAnnotationsFromRequestHeadersWithDiagnostics(headers)
    ).pipe(
      Effect.flatMap(({ annotations, unexpectedConsentCookieReasons }) =>
        Effect.andThen(
          logUnexpectedConsentCookieReasons(unexpectedConsentCookieReasons),
          effect
        ).pipe(Effect.annotateLogs(annotations))
      )
    );
  };
