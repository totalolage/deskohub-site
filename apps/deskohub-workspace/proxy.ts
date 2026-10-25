import {
  getLocaleFromRequestPathname,
  getLocalizedRedirectPathname,
  setLocaleCookie,
} from "@deskohub/i18n/next";
import { getSessionCookie } from "better-auth/cookies";
import { Result } from "effect";
import {
  type MiddlewareConfig,
  type NextRequest,
  NextResponse,
} from "next/server";
import { resolveCustomerAgentConnectStep } from "@/features/account/customer-agent-routes";
import {
  findLegacyAccountSectionRedirect,
  getAccountSignInPath,
} from "@/features/account/routes";
import { administrationRequestPathHeader } from "@/features/administrators/administration-request-path";
import { exactLocaleRedirect } from "@/features/i18n/exact-locale-redirect";
import { resolveWorkspaceLocale } from "@/features/i18n/locale-resolution";
import {
  getLocalizedPagePath,
  localeCookieName,
  locales,
} from "@/features/i18n/routing";
import {
  findLocalizedPublicPage,
  getPageMarkdownRoutePath,
  prefersMarkdown,
} from "@/features/public-pages/page-markdown-negotiation";
import {
  findSharedReferralCodeToRemember,
  referralCodeCookieName,
} from "@/features/referrals/referral-code-cookie";
import { env } from "./env";
import { appendVercelPreviewProtectionBypass } from "./features/checkout/backend/checkout/vercel-preview-protection-bypass";
import { reservationAccessTokenQueryParam } from "./features/reservation/reservation-access-token";
import { classifyAgentTraffic } from "./shared/agent-traffic/agent-traffic";
import { scheduleAgentPageRequest } from "./shared/backend/agent-traffic/agent-page-request";
import { resolveWorkspaceRuntimeCallbackOrigin } from "./shared/backend/config/workspace-url.config";
import { withRequestPathname } from "./shared/backend/utils/request-pathname";
import { markPrivateResponse } from "./shared/utils/private-response";
import { workspaceSiteOrigin } from "./shared/utils/site-constants";

const decodePathname = (pathname: string) => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
};

// The administration lives under the locale segment, and its unprefixed URLs
// redirect there. Any first or second segment naming it counts, whatever the
// prefix and however it is encoded, so no spelling of an administration URL
// skips the sign-in redirect or the private cache headers.
const isAdministrationPath = (pathname: string) => {
  const [first, second] = decodePathname(pathname).split("/").slice(1, 3);
  return first === "admin" || second === "admin";
};

const markAdministrationResponse = <T extends Response>(response: T) => {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.append("Vary", "Cookie");
  return response;
};

const isPrivateReservationPath = (pathname: string) =>
  pathname.includes("/reservation/status/") ||
  pathname.includes("/reservation/access/") ||
  pathname.includes("/reservation/invoice/");

const isReservationCapabilityExchangePath = (pathname: string) =>
  pathname.includes("/reservation/status/") ||
  pathname.includes("/reservation/access/");

// Only these requests carry a reservation access token to exchange, so the
// exchange module and its Effect runtime load for them alone.
const hasReservationCapabilityToExchange = (request: NextRequest) =>
  request.method === "GET" &&
  isReservationCapabilityExchangePath(request.nextUrl.pathname) &&
  request.nextUrl.searchParams.has(reservationAccessTokenQueryParam);

const isAccountPath = (pathname: string) => /\/account(\/|$)/.test(pathname);

const isPrivateAccountPath = (pathname: string) =>
  isAccountPath(pathname) || /\/auth(\/|$)/.test(pathname);

/**
 * Hands a request on to its render. An account render receives its pathname,
 * which the account sections' layout checks before it renders the account
 * page; other renders receive the request's own headers when the proxy changed
 * them.
 */
const continueRequest = (
  request: NextRequest,
  { headersChanged }: { readonly headersChanged: boolean }
) => {
  if (isAccountPath(request.nextUrl.pathname)) {
    return NextResponse.next({
      request: { headers: withRequestPathname(request) },
    });
  }
  return headersChanged
    ? NextResponse.next({ request: { headers: request.headers } })
    : NextResponse.next();
};

/**
 * A real top-level page load. Speculative and router requests never take the
 * first-link slot: non-GET requests; Next.js router requests (`rsc`,
 * `next-router-state-tree`) and prefetches (`next-router-prefetch`,
 * `next-router-segment-prefetch`, as Next.js 16 sends them); browser
 * speculative loads (`Sec-Purpose`, or the legacy `Purpose`, naming prefetch
 * or prerender); and, when the browser reports it, anything that is not a
 * document load.
 */
const isDocumentNavigation = (request: NextRequest) => {
  if (request.method !== "GET") return false;
  const { headers } = request;
  if (
    headers.has("rsc") ||
    headers.has("next-router-state-tree") ||
    headers.has("next-router-prefetch") ||
    headers.has("next-router-segment-prefetch")
  ) {
    return false;
  }
  const purpose = `${headers.get("sec-purpose") ?? ""};${headers.get("purpose") ?? ""}`;
  if (/prefetch|prerender/i.test(purpose)) return false;
  const destination = headers.get("sec-fetch-dest");
  return destination === null || destination === "document";
};

/**
 * The shared referral code a real page load carries while the browser
 * remembers none yet. The proxy cannot read the referrals feature flag, so it
 * never stores the code: it only hands it to this request's own render, whose
 * gated reader ignores it while the program is withheld. The shown page's
 * gated `RememberSharedReferralCode` remembers it.
 */
const findSharedReferralCodeOfNavigation = (request: NextRequest) =>
  isDocumentNavigation(request)
    ? findSharedReferralCodeToRemember(
        request.nextUrl.searchParams,
        request.cookies
      )
    : undefined;

// Only page requests from a browser holding a session cookie can carry a saved
// locale preference, so guests and router prefetches never load the reader or
// touch the database. Prefetched links already share the page's locale. The
// cookie check is Better Auth's optimistic presence test; the reader then
// validates the session through Better Auth. A reader that fails to load
// counts as no preference, like a failed read.
//
// Accepted side effect: for a correctly signed cookie of an expired or revoked
// session, Better Auth's `getSession` deletes the expired session row and
// expires the cookie through `nextCookies`. Next then replaces this response's
// Set-Cookie with that expiry, so the locale cookie is not refreshed on this
// one response; the URL still carries the locale, and the next (guest) request
// sets the cookie again.
const pageLocalePreference = async (request: NextRequest) => {
  if (
    (request.method !== "GET" && request.method !== "HEAD") ||
    request.headers.has("next-router-prefetch") ||
    !getSessionCookie(request)
  ) {
    return undefined;
  }

  try {
    const { readPageLocalePreference } = await import(
      "./features/i18n/server/page-locale-preference.server"
    );
    return await readPageLocalePreference(request.headers, request.nextUrl);
  } catch {
    return undefined;
  }
};

// Places a page request on the URL the Workspace locale chain resolves.
// `forwardRequestHeaders` passes headers the proxy set on the request on to
// the page.
async function localizedPageResponse(
  request: NextRequest,
  { forwardRequestHeaders = false } = {}
) {
  const localeFromUrl = getLocaleFromRequestPathname(request, locales);

  // A reservation capability is bound to the locale it was issued in, so it is
  // exchanged before any preference redirect moves the request elsewhere.
  if (localeFromUrl && hasReservationCapabilityToExchange(request)) {
    const { exchangeReservationCapability } = await import(
      "./features/reservation/backend/reservation-capability-exchange"
    );
    return exchangeReservationCapability(request, localeFromUrl);
  }

  // A verified continuation (a Pay state or an invoice link) keeps the locale
  // it was issued in; the saved preference applies everywhere else.
  const savedPreference = await pageLocalePreference(request);
  const resolvedLocale = resolveWorkspaceLocale(
    {
      pathname: request.nextUrl.pathname,
      cookies: request.cookies,
      headers: request.headers,
    },
    savedPreference
  );

  if (localeFromUrl === resolvedLocale) {
    const sectionRedirect = findLegacyAccountSectionRedirect(
      resolvedLocale,
      new URL(request.url)
    );
    if (sectionRedirect) {
      const response = markPrivateResponse(
        NextResponse.redirect(sectionRedirect)
      );
      setLocaleCookie(response, localeCookieName, resolvedLocale);
      return response;
    }

    const publicPage = findLocalizedPublicPage(request.nextUrl.pathname);
    if (publicPage && requestsPageMarkdown(request)) {
      recordAgentPageRequest(request, resolvedLocale);
      return NextResponse.rewrite(
        new URL(
          getPageMarkdownRoutePath(publicPage.locale, publicPage.pathname),
          request.url
        )
      );
    }

    const sharedReferralCode = findSharedReferralCodeOfNavigation(request);
    if (sharedReferralCode) {
      request.cookies.set(referralCodeCookieName, sharedReferralCode);
    }
    recordAgentPageRequest(request, resolvedLocale);
    const response = continueRequest(request, {
      headersChanged: Boolean(sharedReferralCode) || forwardRequestHeaders,
    });
    // The same URL answers with Markdown when `Accept` prefers it.
    if (publicPage) response.headers.append("Vary", "Accept");
    if (
      isPrivateReservationPath(request.nextUrl.pathname) ||
      isPrivateAccountPath(request.nextUrl.pathname)
    ) {
      markPrivateResponse(response);
    }
    setLocaleCookie(response, localeCookieName, resolvedLocale);
    return response;
  }

  const localizedUrl = request.nextUrl.clone();
  localizedUrl.pathname = getLocalizedRedirectPathname(
    request.nextUrl.pathname,
    resolvedLocale,
    locales
  );
  // A retired account section link goes straight to its section's path.
  const redirectUrl =
    findLegacyAccountSectionRedirect(
      resolvedLocale,
      new URL(localizedUrl.href)
    ) ?? localizedUrl;

  const response = NextResponse.redirect(redirectUrl);
  response.headers.set("Vary", "Accept-Language");
  if (
    savedPreference !== undefined ||
    isPrivateReservationPath(request.nextUrl.pathname)
  ) {
    markPrivateResponse(response);
  }
  setLocaleCookie(response, localeCookieName, resolvedLocale);
  return response;
}

// A public page load whose `Accept` header prefers Markdown gets the page's
// Markdown variant instead of its HTML.
const requestsPageMarkdown = (request: NextRequest) =>
  (request.method === "GET" || request.method === "HEAD") &&
  prefersMarkdown(request.headers);

// One event per agent page load that reaches a render; humans and other
// unclassified traffic send none. A path no page matches renders the
// not-found page and is reported as the `unknown` route.
const recordAgentPageRequest = (request: NextRequest, locale: string) => {
  const traffic = classifyAgentTraffic(request.headers);
  if (
    traffic.category === "unclassified" ||
    !isDocumentNavigation(request) ||
    isAdministrationPath(request.nextUrl.pathname)
  ) {
    return;
  }
  scheduleAgentPageRequest({
    traffic,
    locale,
    pathname: request.nextUrl.pathname,
  });
};

const requestLocale = (request: NextRequest) =>
  resolveWorkspaceLocale(
    {
      pathname: request.nextUrl.pathname,
      cookies: request.cookies,
      headers: request.headers,
    },
    undefined
  );

// Sends a signed-out page load to sign-in, coming back afterwards.
const administrationSignInRedirect = (request: NextRequest) =>
  NextResponse.redirect(
    new URL(
      getAccountSignInPath(
        requestLocale(request),
        `${request.nextUrl.pathname}${request.nextUrl.search}`
      ),
      request.nextUrl
    )
  );

// Serves the ordinary customer 404 page: the catch-all route answers any
// unknown path with it, so the administration isn't advertised.
const ordinaryNotFound = (request: NextRequest) =>
  NextResponse.rewrite(
    new URL(
      `/${requestLocale(request)}/administration-not-found`,
      request.nextUrl
    )
  );

// Who a page load acts as. Pages stream behind a static shell, so their own
// guards can't change the status or hide the shell once it is sent; the
// proxy reads the session and the grant first. Without a session cookie
// (Better Auth's optimistic check) there is nothing to read.
const administrationPageAccess = async (request: NextRequest) => {
  if (!getSessionCookie(request)) return "signed-out" as const;
  const { readAdministrationRequestAccess } = await import(
    "./features/administrators/server/administration-request-access.server"
  );
  return readAdministrationRequestAccess(request.headers);
};

async function administrationResponse(request: NextRequest) {
  // A Server Action reaches its guard, which fails closed without a redirect.
  if (request.method === "POST" && request.headers.has("next-action")) {
    return NextResponse.next();
  }
  if (request.method === "GET" || request.method === "HEAD") {
    const access = await administrationPageAccess(request).catch(
      () => "unavailable" as const
    );
    if (access === "signed-out") return administrationSignInRedirect(request);
    if (access === "not-administrator") return ordinaryNotFound(request);
    if (access === "unavailable") {
      return new NextResponse(null, { status: 503 });
    }
  }
  request.headers.set(
    administrationRequestPathHeader,
    `${request.nextUrl.pathname}${request.nextUrl.search}`
  );
  return localizedPageResponse(request, { forwardRequestHeaders: true });
}

// Sends a signed-out visitor of the AI assistant sign-in step straight to
// sign-in with an HTTP redirect. The page streams behind its shell, so its
// own redirect would run in the browser as a client navigation, which the
// site's modal slot intercepts and shows over an empty page.
const customerAgentSignInRedirect = (request: NextRequest) => {
  if (request.method !== "GET" && request.method !== "HEAD") return;
  if (getSessionCookie(request)) return;
  const locale = getLocaleFromRequestPathname(request, locales);
  if (!locale) return;
  const connectPath = getLocalizedPagePath(locale, "/[locale]/auth/connect");
  if (request.nextUrl.pathname !== connectPath) return;

  const step = resolveCustomerAgentConnectStep({
    connectPath,
    query: request.nextUrl.searchParams,
    signedIn: false,
  });
  if (step.step !== "sign-in") return;
  return markPrivateResponse(
    NextResponse.redirect(
      new URL(
        getAccountSignInPath(locale, step.returnTo, "assistant"),
        request.nextUrl
      )
    )
  );
};

// Production also answers on its `*.vercel.app` aliases. Their page loads move
// permanently to the canonical origin, so search engines index one host.
// Preview deployments serve their own hosts.
const canonicalHostRedirect = (request: NextRequest) => {
  if (
    env.VERCEL_ENV !== "production" ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    return undefined;
  }
  const canonicalOrigin = new URL(workspaceSiteOrigin);
  if (request.nextUrl.host === canonicalOrigin.host) return undefined;

  return NextResponse.redirect(
    new URL(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      canonicalOrigin
    ),
    308
  );
};

// A redirect that keeps the query can carry a reservation capability or an
// account continuation, so a private path's redirect answers privately too.
const markRedirectPrivacy = (request: NextRequest, response: NextResponse) => {
  const { pathname } = request.nextUrl;
  if (isAdministrationPath(pathname)) {
    return markAdministrationResponse(response);
  }
  return isPrivateReservationPath(pathname) || isPrivateAccountPath(pathname)
    ? markPrivateResponse(response)
    : response;
};

export async function proxy(request: NextRequest) {
  // The exact-locale redirect comes before any locale or sign-in redirect
  // could prefix the path a second time.
  const normalizingRedirect =
    canonicalHostRedirect(request) ??
    exactLocaleRedirect(request.method, request.nextUrl);
  if (normalizingRedirect) {
    return markRedirectPrivacy(request, normalizingRedirect);
  }

  // Outside the account and the administration, a dotted path reaches the
  // proxy only for the exact-locale redirect, so a file-like path under an
  // exact locale goes on untouched to the localized catch-all.
  const { pathname } = request.nextUrl;
  if (
    pathname.includes(".") &&
    !isAccountPath(pathname) &&
    !isAdministrationPath(pathname)
  ) {
    return NextResponse.next();
  }

  if (isAdministrationPath(pathname)) {
    return markAdministrationResponse(await administrationResponse(request));
  }

  if (request.method === "POST" && request.headers.has("next-action")) {
    return continueRequest(request, { headersChanged: false });
  }

  if (
    env.VERCEL_ENV === "preview" &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    const callbackOrigin = Result.getOrThrow(
      resolveWorkspaceRuntimeCallbackOrigin()
    );
    if (request.nextUrl.origin !== callbackOrigin.origin) {
      const redirectUrl = new URL(
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
        callbackOrigin
      );
      appendVercelPreviewProtectionBypass(redirectUrl, {
        setBypassCookie: true,
      });
      return markPrivateResponse(NextResponse.redirect(redirectUrl));
    }
  }

  return customerAgentSignInRedirect(request) ?? localizedPageResponse(request);
}

// Every account route, dotted segments included, passes through the proxy: the
// account sections' layout trusts the request pathname only because the proxy
// replaces any value a client sent. A dotted path under a locale-shaped prefix
// passes through too, so `/en-us/x.html` gets the exact-locale redirect: the
// rewrite in `next.config.mjs` ignores letter case and cannot tell it from
// `/en-US/x.html`. The prefix spells out both letter cases because matchers
// compare them. RSC and segment requests stay out: Next strips their suffix
// before the proxy sees the URL, so they would pass for page loads.
export const config: MiddlewareConfig = {
  matcher: [
    "/admin/:path*",
    "/:locale/admin/:path*",
    "/account/:path*",
    "/:locale((?!api)[^/]+)/account/:path*",
    "/([a-zA-Z]{2}-[a-zA-Z]{2}/(?!.*\\.(?:prefetch\\.)?rsc$|.*\\.segments/).*\\..*)",
    "/((?!api|_next/static|_next/image|favicon.ico|favicon.svg|.*\\..*).*)",
  ],
};
