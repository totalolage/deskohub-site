import {
  PostHogDistinctId,
  PostHogSessionId,
} from "@deskohub/posthog/identifiers";
import { Context, Effect, Option, Schema } from "effect";
import { type CookieStore, cookieStoreFromHeader } from "posthog-node";
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

export interface PostHogRequestContext {
  readonly distinctId?: PostHogDistinctId;
  readonly sessionId?: PostHogSessionId;
}

export const CurrentPostHogRequestContext = Context.Reference(
  "@deskohub-workspace/analytics/CurrentPostHogRequestContext",
  { defaultValue: (): PostHogRequestContext => ({}) }
);

interface PostHogCookieValues {
  readonly distinctId?: unknown;
  readonly sessionId?: unknown;
}

export interface PostHogRequestContextResult {
  readonly context: PostHogRequestContext;
  readonly unexpectedConsentCookieReasons: readonly UnexpectedConsentCookieReason[];
}

export function getPostHogRequestContextFromCookieValues({
  distinctId,
  sessionId,
}: PostHogCookieValues): PostHogRequestContext {
  const decodedDistinctId = Option.getOrUndefined(
    Schema.decodeUnknownOption(PostHogDistinctId)(distinctId)
  );
  const decodedSessionId = Option.getOrUndefined(
    Schema.decodeUnknownOption(PostHogSessionId)(sessionId)
  );

  return {
    distinctId: decodedDistinctId,
    sessionId: decodedSessionId,
  };
}

export function getPostHogRequestContextFromCookieHeader(
  cookieHeader: string | null | undefined
): PostHogRequestContext {
  return getPostHogRequestContextFromCookies(
    cookieStoreFromHeader(cookieHeader ?? "")
  );
}

export function getPostHogRequestContextFromRequestHeaders(
  headers: Headers
): PostHogRequestContext {
  return getPostHogRequestContextFromRequestHeadersWithDiagnostics(headers)
    .context;
}

export function getPostHogRequestContextFromRequestHeadersWithDiagnostics(
  headers: Headers
): PostHogRequestContextResult {
  const cookieHeader = headers.get("cookie");
  const cookies = cookieStoreFromHeader(cookieHeader ?? "");
  const unexpectedConsentCookieReasons: UnexpectedConsentCookieReason[] = [];
  if (!hasAnalyticsConsent(cookieHeader, unexpectedConsentCookieReasons)) {
    return { context: {}, unexpectedConsentCookieReasons };
  }

  const cookieContext = getPostHogRequestContextFromCookies(cookies);

  // PostHog tracing headers can outlive a no-reload consent revoke in the browser.
  if (!cookieContext.distinctId || !cookieContext.sessionId) {
    return {
      context: cookieContext,
      unexpectedConsentCookieReasons,
    };
  }

  const headerContext = getPostHogRequestContextFromCookieValues({
    distinctId: headers.get(POSTHOG_DISTINCT_ID_HEADER) ?? undefined,
    sessionId: headers.get(POSTHOG_SESSION_ID_HEADER) ?? undefined,
  });

  return {
    context: {
      distinctId: headerContext.distinctId ?? cookieContext.distinctId,
      sessionId: headerContext.sessionId ?? cookieContext.sessionId,
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

function getPostHogRequestContextFromCookies(cookies: CookieStore) {
  return getPostHogRequestContextFromCookieValues({
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
