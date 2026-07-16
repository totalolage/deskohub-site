import {
  getPostHogRequestContextFromCookieHeader,
  getPostHogRequestContextFromRequestHeadersWithDiagnostics,
  logUnexpectedConsentCookieReasons,
  type PostHogRequestContext,
} from "@/shared/backend/analytics/posthog-request-context";

export { logUnexpectedConsentCookieReasons };

export type PostHogLogAnnotations = {
  readonly posthogDistinctId?: string;
  readonly sessionId?: string;
};

interface PostHogLogAnnotationResult {
  readonly annotations: PostHogLogAnnotations;
  readonly unexpectedConsentCookieReasons: ReturnType<
    typeof getPostHogRequestContextFromRequestHeadersWithDiagnostics
  >["unexpectedConsentCookieReasons"];
}

export function getPostHogLogAnnotationsFromCookieValues({
  distinctId,
  sessionId,
}: PostHogRequestContext): PostHogLogAnnotations {
  return {
    ...(distinctId ? { posthogDistinctId: distinctId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export function getPostHogLogAnnotationsFromCookieHeader(
  cookieHeader: string | null | undefined
): PostHogLogAnnotations {
  return getPostHogLogAnnotationsFromCookieValues(
    getPostHogRequestContextFromCookieHeader(cookieHeader)
  );
}

export function getPostHogLogAnnotationsFromRequestHeaders(
  headers: Headers
): PostHogLogAnnotations {
  return getPostHogLogAnnotationsFromRequestHeadersWithDiagnostics(headers)
    .annotations;
}

export function getPostHogLogAnnotationsFromRequestHeadersWithDiagnostics(
  headers: Headers
): PostHogLogAnnotationResult {
  const { context, unexpectedConsentCookieReasons } =
    getPostHogRequestContextFromRequestHeadersWithDiagnostics(headers);

  return {
    annotations: getPostHogLogAnnotationsFromCookieValues(context),
    unexpectedConsentCookieReasons,
  };
}
