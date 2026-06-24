export const POSTHOG_DISTINCT_ID_COOKIE = "dh_ph_distinct_id";
export const POSTHOG_SESSION_ID_COOKIE = "dh_ph_session_id";

const DISTINCT_ID_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const SESSION_ID_MAX_AGE_SECONDS = 60 * 60 * 24;

type PostHogSessionCookieValues = {
  distinctId: string;
  sessionId: string;
};

export function createPostHogSessionCookieStrings({
  distinctId,
  sessionId,
}: PostHogSessionCookieValues) {
  return [
    createCookieString(
      POSTHOG_DISTINCT_ID_COOKIE,
      distinctId,
      DISTINCT_ID_MAX_AGE_SECONDS
    ),
    createCookieString(
      POSTHOG_SESSION_ID_COOKIE,
      sessionId,
      SESSION_ID_MAX_AGE_SECONDS
    ),
  ];
}

export function createPostHogSessionClearCookieStrings() {
  return [
    createCookieString(POSTHOG_DISTINCT_ID_COOKIE, "", 0),
    createCookieString(POSTHOG_SESSION_ID_COOKIE, "", 0),
  ];
}

export function writePostHogSessionCookie(cookie: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API is not available in every browser we support.
  document.cookie = cookie;
}

function createCookieString(
  name: string,
  value: string,
  maxAgeSeconds: number
) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}
