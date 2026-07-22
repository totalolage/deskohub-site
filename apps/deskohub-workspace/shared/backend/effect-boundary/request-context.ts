import { Effect } from "effect";
import {
  getPostHogLogAnnotationsFromRequestHeadersWithDiagnostics,
  logUnexpectedConsentCookieReasons,
} from "../logging/posthog-log-annotations";

export const withWorkspaceRequestContext = <A, E, R>(
  headers: Headers,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.sync(() =>
    getPostHogLogAnnotationsFromRequestHeadersWithDiagnostics(headers)
  ).pipe(
    Effect.flatMap(({ annotations, unexpectedConsentCookieReasons }) =>
      Effect.andThen(
        logUnexpectedConsentCookieReasons(unexpectedConsentCookieReasons),
        effect
      ).pipe(Effect.annotateLogs(annotations))
    )
  );
