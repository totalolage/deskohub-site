import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";

const POSTHOG_DISTINCT_ID_HEADER = "X-POSTHOG-DISTINCT-ID";
const POSTHOG_SESSION_ID_HEADER = "X-POSTHOG-SESSION-ID";
const CONSENT_COOKIE = "cc_cookie";

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
  if (!cookieHeader) return {};

  const values: PostHogCookieValues = {};

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex === -1) continue;

    const name = cookie.slice(0, separatorIndex).trim();
    const value = decodeCookieValue(cookie.slice(separatorIndex + 1).trim());

    if (name === POSTHOG_DISTINCT_ID_COOKIE) {
      values.distinctId = value;
    }
    if (name === POSTHOG_SESSION_ID_COOKIE) {
      values.sessionId = value;
    }
  }

  return getPostHogLogAnnotationsFromCookieValues(values);
}

export function getPostHogLogAnnotationsFromRequestHeaders(
  headers: Headers
): PostHogLogAnnotations {
  const cookieHeader = headers.get("cookie");
  if (!hasAnalyticsConsent(cookieHeader)) return {};

  const cookieAnnotations =
    getPostHogLogAnnotationsFromCookieHeader(cookieHeader);

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

function decodeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hasAnalyticsConsent(cookieHeader: string | null | undefined) {
  if (!cookieHeader) return false;

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex === -1) continue;

    const name = cookie.slice(0, separatorIndex).trim();
    if (name !== CONSENT_COOKIE) continue;

    try {
      const value = JSON.parse(
        decodeCookieValue(cookie.slice(separatorIndex + 1).trim())
      );

      return (
        typeof value === "object" &&
        value !== null &&
        Array.isArray((value as { categories?: unknown }).categories) &&
        (value as { categories: unknown[] }).categories.includes("analytics")
      );
    } catch {
      return false;
    }
  }

  return false;
}
