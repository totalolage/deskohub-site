import { RequestCookies } from "next/dist/server/web/spec-extension/cookies";
import {
  getAcceptedConsentCategoriesFromCookieValue,
  getConsentCookieValuesFromCookie,
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
  const cookieHeader = headers.get("cookie");
  const cookies = new RequestCookies(headers);
  if (!hasAnalyticsConsent(cookieHeader)) return {};

  const cookieAnnotations = getPostHogLogAnnotationsFromCookies(cookies);

  // PostHog tracing headers can outlive a no-reload consent revoke in the browser.
  if (!cookieAnnotations.posthogDistinctId || !cookieAnnotations.sessionId) {
    return cookieAnnotations;
  }

  return {
    ...cookieAnnotations,
    ...getPostHogLogAnnotationsFromCookieValues({
      distinctId: headers.get(POSTHOG_DISTINCT_ID_HEADER) ?? undefined,
      sessionId: headers.get(POSTHOG_SESSION_ID_HEADER) ?? undefined,
    }),
  };
}

function getPostHogLogAnnotationsFromCookies(cookies: RequestCookies) {
  return getPostHogLogAnnotationsFromCookieValues({
    distinctId: cookies.get(POSTHOG_DISTINCT_ID_COOKIE)?.value,
    sessionId: cookies.get(POSTHOG_SESSION_ID_COOKIE)?.value,
  });
}

function hasAnalyticsConsent(cookieHeader: string | null) {
  const consentCookieValues = getConsentCookieValuesFromCookie(
    cookieHeader ?? ""
  );
  return (
    consentCookieValues.length > 0 &&
    consentCookieValues.every((value) =>
      getAcceptedConsentCategoriesFromCookieValue(value).includes("analytics")
    )
  );
}
