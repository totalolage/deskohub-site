import { Effect } from "effect";
import { RequestCookies } from "next/dist/server/web/spec-extension/cookies";
import {
  getAcceptedConsentCategoriesFromCookieValue,
  getConsentCookieValuesFromCookie,
  type UnexpectedConsentCookieReason,
} from "@/shared/utils/consent-cookie";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";

const POSTHOG_DISTINCT_ID_HEADER = "X-POSTHOG-DISTINCT-ID";
const POSTHOG_SESSION_ID_HEADER = "X-POSTHOG-SESSION-ID";

export type PostHogLogAnnotations = {
  readonly posthogDistinctId?: string;
  readonly sessionId?: string;
};

type PostHogCookieValues = {
  distinctId?: string;
  sessionId?: string;
};

type PostHogLogAnnotationResult = {
  readonly annotations: PostHogLogAnnotations;
  readonly unexpectedConsentCookieReasons: readonly UnexpectedConsentCookieReason[];
};

export function getPostHogLogAnnotationsFromCookieValues({
  distinctId,
  sessionId,
}: PostHogCookieValues): PostHogLogAnnotations {
  return {
    ...(distinctId ? { posthogDistinctId: distinctId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export function getPostHogLogAnnotationsFromCookieHeader(
  cookieHeader: string | null | undefined
): PostHogLogAnnotations {
  return getPostHogLogAnnotationsFromCookies(
    new RequestCookies(
      new Headers(cookieHeader ? { cookie: cookieHeader } : {})
    )
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
  const cookieHeader = headers.get("cookie");
  const cookies = new RequestCookies(headers);
  const unexpectedConsentCookieReasons: UnexpectedConsentCookieReason[] = [];
  if (!hasAnalyticsConsent(cookieHeader, unexpectedConsentCookieReasons)) {
    return { annotations: {}, unexpectedConsentCookieReasons };
  }

  const cookieAnnotations = getPostHogLogAnnotationsFromCookies(cookies);

  // PostHog tracing headers can outlive a no-reload consent revoke in the browser.
  if (!cookieAnnotations.posthogDistinctId || !cookieAnnotations.sessionId) {
    return {
      annotations: cookieAnnotations,
      unexpectedConsentCookieReasons,
    };
  }

  return {
    annotations: {
      ...cookieAnnotations,
      ...getPostHogLogAnnotationsFromCookieValues({
        distinctId: headers.get(POSTHOG_DISTINCT_ID_HEADER) ?? undefined,
        sessionId: headers.get(POSTHOG_SESSION_ID_HEADER) ?? undefined,
      }),
    },
    unexpectedConsentCookieReasons,
  };
}

export function logUnexpectedConsentCookieReasons(
  reasons: readonly UnexpectedConsentCookieReason[]
) {
  return reasons.length
    ? Effect.logWarning("Unexpected cookie consent value", { reasons })
    : Effect.void;
}

function getPostHogLogAnnotationsFromCookies(cookies: RequestCookies) {
  return getPostHogLogAnnotationsFromCookieValues({
    distinctId: cookies.get(POSTHOG_DISTINCT_ID_COOKIE)?.value,
    sessionId: cookies.get(POSTHOG_SESSION_ID_COOKIE)?.value,
  });
}

function hasAnalyticsConsent(
  cookieHeader: string | null,
  unexpectedConsentCookieReasons: UnexpectedConsentCookieReason[]
) {
  const consentCookieValues = getConsentCookieValuesFromCookie(
    cookieHeader ?? ""
  );
  if (consentCookieValues.length === 0) return false;

  let allConsentCookiesAcceptAnalytics = true;
  for (const value of consentCookieValues) {
    const acceptedCategories = getAcceptedConsentCategoriesFromCookieValue(
      value,
      {
        onUnexpectedValue: (reason) => {
          unexpectedConsentCookieReasons.push(reason);
        },
      }
    );
    if (!acceptedCategories.includes("analytics")) {
      allConsentCookiesAcceptAnalytics = false;
    }
  }

  return allConsentCookiesAcceptAnalytics;
}
