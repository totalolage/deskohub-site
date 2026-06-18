import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";

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

function decodeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
