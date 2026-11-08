import {
  PostHogDistinctId,
  PostHogSessionId,
} from "@deskohub/posthog/identifiers";
import { Effect, Option, Schema } from "effect";
import { type CookieStore, cookieStoreFromHeader } from "posthog-node";
import { getConsentBannerRevision } from "@/features/legal/consent-banner-revision";
import {
  isConsentCategoryAcceptedInCookie,
  type UnexpectedConsentCookieReason,
} from "@/shared/utils/consent-cookie";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";

const POSTHOG_DISTINCT_ID_HEADER = "X-POSTHOG-DISTINCT-ID";
const POSTHOG_SESSION_ID_HEADER = "X-POSTHOG-SESSION-ID";

/**
 * The PostHog visitor a request comes from, known only when the visitor
 * consented to analytics. Empty for an anonymous visitor.
 */
export interface VisitorIdentity {
  readonly distinctId?: PostHogDistinctId;
  readonly sessionId?: PostHogSessionId;
}

export const anonymousVisitor: VisitorIdentity = {};

/**
 * The consented visitor behind `headers`. Without analytics consent in every
 * copy of the consent cookie, saved under the current banner revision, the
 * visitor stays anonymous. PostHog's tracing
 * headers name the visitor only once both first-party cookie identifiers
 * exist, since the headers can outlive a consent revoked without a reload.
 * Logs a warning for each unexpected consent cookie value.
 */
export const readVisitorIdentity = (headers: Headers) =>
  Effect.suspend(() => {
    const unexpectedConsentCookieReasons: UnexpectedConsentCookieReason[] = [];
    const identity = visitorIdentityOf(headers, unexpectedConsentCookieReasons);
    return unexpectedConsentCookieReasons.length === 0
      ? Effect.succeed(identity)
      : Effect.logWarning("Unexpected cookie consent value", {
          reasons: unexpectedConsentCookieReasons,
        }).pipe(Effect.as(identity));
  });

function visitorIdentityOf(
  headers: Headers,
  unexpectedConsentCookieReasons: UnexpectedConsentCookieReason[]
): VisitorIdentity {
  const cookieHeader = headers.get("cookie") ?? "";
  const hasAnalyticsConsent = isConsentCategoryAcceptedInCookie(
    cookieHeader,
    "analytics",
    {
      revision: getConsentBannerRevision(),
      onUnexpectedValue: (reason) => {
        unexpectedConsentCookieReasons.push(reason);
      },
    }
  );
  if (!hasAnalyticsConsent) return anonymousVisitor;

  const cookieIdentity = identityFromCookies(
    cookieStoreFromHeader(cookieHeader)
  );
  if (!cookieIdentity.distinctId || !cookieIdentity.sessionId) {
    return cookieIdentity;
  }

  const headerIdentity = decodeIdentity({
    distinctId: headers.get(POSTHOG_DISTINCT_ID_HEADER) ?? undefined,
    sessionId: headers.get(POSTHOG_SESSION_ID_HEADER) ?? undefined,
  });
  return {
    distinctId: headerIdentity.distinctId ?? cookieIdentity.distinctId,
    sessionId: headerIdentity.sessionId ?? cookieIdentity.sessionId,
  };
}

function identityFromCookies(cookies: CookieStore) {
  return decodeIdentity({
    distinctId: cookies.get(POSTHOG_DISTINCT_ID_COOKIE)?.value,
    sessionId: cookies.get(POSTHOG_SESSION_ID_COOKIE)?.value,
  });
}

function decodeIdentity(values: {
  readonly distinctId?: unknown;
  readonly sessionId?: unknown;
}): VisitorIdentity {
  return {
    distinctId: Option.getOrUndefined(
      Schema.decodeUnknownOption(PostHogDistinctId)(values.distinctId)
    ),
    sessionId: Option.getOrUndefined(
      Schema.decodeUnknownOption(PostHogSessionId)(values.sessionId)
    ),
  };
}
