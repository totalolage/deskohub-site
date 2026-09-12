import {
  getLocaleFromRequestPathname,
  getLocalizedRedirectPathname,
  resolveRequestLocale,
  setLocaleCookie,
} from "@deskohub/i18n/next";
import { Effect, Option, Schema } from "effect";
import {
  type MiddlewareConfig,
  type NextRequest,
  NextResponse,
} from "next/server";
import {
  localeConfig,
  localeCookieName,
  locales,
} from "@/features/i18n/routing";
import { env } from "./env";
import {
  createReservationAccessCookieCapability,
  parseCanonicalReservationAccessUrl,
  parseCanonicalReservationStatusUrl,
  writeReservationAccessCookie,
} from "./features/reservation/backend/reservation-access-cookie";
import { openReservationAccessToken } from "./features/reservation/backend/reservation-access-token";
import {
  reservationAccessTokenQueryParam,
  reservationAccessTokenSchema,
} from "./features/reservation/reservation-access-token";
import { isAdministratorAuthorizationValid } from "./shared/administrator/administrator-basic-auth";
import { runWorkspaceEffect } from "./shared/backend/workspace-effect";

const isAdministrationPath = (pathname: string) =>
  pathname === "/admin" || pathname.startsWith("/admin/");

const isPrivateReservationPath = (pathname: string) =>
  pathname.includes("/reservation/status/") ||
  pathname.includes("/reservation/access/") ||
  pathname.includes("/reservation/invoice/");

const isReservationCapabilityExchangePath = (pathname: string) =>
  pathname.includes("/reservation/status/") ||
  pathname.includes("/reservation/access/");

const privateResponse = <T extends Response>(response: T) => {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
};

const rejectReservationCapabilityExchange = () =>
  privateResponse(new NextResponse(null, { status: 404 }));

const exchangeReservationCapability = (
  request: NextRequest,
  locale: (typeof locales)[number]
): Effect.Effect<NextResponse | undefined> => {
  if (request.method !== "GET") return Effect.succeed(undefined);
  if (!isReservationCapabilityExchangePath(request.nextUrl.pathname)) {
    return Effect.succeed(undefined);
  }

  const accessTokens = request.nextUrl.searchParams.getAll(
    reservationAccessTokenQueryParam
  );
  if (accessTokens.length === 0) return Effect.succeed(undefined);
  if (accessTokens.length !== 1) {
    return Effect.succeed(rejectReservationCapabilityExchange());
  }
  const accessTokenValue = accessTokens[0];
  if (!accessTokenValue) {
    return Effect.succeed(rejectReservationCapabilityExchange());
  }

  const accessToken = Option.getOrUndefined(
    Schema.decodeOption(reservationAccessTokenSchema)(accessTokenValue)
  );
  if (!accessToken) {
    return Effect.succeed(rejectReservationCapabilityExchange());
  }

  const cleanUrl = request.nextUrl.clone();
  cleanUrl.searchParams.delete(reservationAccessTokenQueryParam);
  const pathWithCapabilityExchangeParams = `${cleanUrl.pathname}${cleanUrl.search}`;
  const orderId =
    parseCanonicalReservationStatusUrl(
      pathWithCapabilityExchangeParams,
      locale
    ) ??
    parseCanonicalReservationAccessUrl(
      pathWithCapabilityExchangeParams,
      locale
    );
  if (!orderId) {
    return Effect.succeed(rejectReservationCapabilityExchange());
  }

  cleanUrl.searchParams.delete("x-vercel-protection-bypass");
  cleanUrl.searchParams.delete("x-vercel-set-bypass-cookie");
  const cleanPath = `${cleanUrl.pathname}${cleanUrl.search}`;

  return Effect.gen(function* () {
    const tokenClaims = yield* openReservationAccessToken({
      token: accessToken,
      orderId,
      locale,
    });
    const response = NextResponse.redirect(new URL(cleanPath, request.url));
    const capability = yield* createReservationAccessCookieCapability({
      orderId,
      locale: tokenClaims.locale,
    });
    yield* writeReservationAccessCookie(response.cookies, {
      orderId,
      capability,
    });
    setLocaleCookie(response, localeCookieName, locale);
    return privateResponse(response);
  }).pipe(
    Effect.catch(() => Effect.succeed(rejectReservationCapabilityExchange()))
  );
};

const isPrivateAccountPath = (pathname: string) =>
  /\/account(\/|$)/.test(pathname) || /\/auth(\/|$)/.test(pathname);

export async function proxy(request: NextRequest) {
  if (isAdministrationPath(request.nextUrl.pathname)) {
    if (
      !isAdministratorAuthorizationValid(
        request.headers.get("authorization"),
        env.ADMIN_BASIC_AUTH_CREDENTIALS
      )
    ) {
      return new NextResponse(null, {
        status: 401,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Authorization",
          "WWW-Authenticate":
            'Basic realm="Deskohub administration", charset="UTF-8"',
        },
      });
    }

    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Authorization");
    return response;
  }

  if (request.method === "POST" && request.headers.has("next-action")) {
    return NextResponse.next();
  }

  const localeFromUrl = getLocaleFromRequestPathname(request, locales);

  if (localeFromUrl) {
    const exchanged = await exchangeReservationCapability(
      request,
      localeFromUrl
    ).pipe(
      runWorkspaceEffect("reservation.access.exchange", { boundary: "route" })
    );
    if (exchanged) return exchanged;

    const response = NextResponse.next();
    if (
      isPrivateReservationPath(request.nextUrl.pathname) ||
      isPrivateAccountPath(request.nextUrl.pathname)
    ) {
      privateResponse(response);
    }
    setLocaleCookie(response, localeCookieName, localeFromUrl);
    return response;
  }

  const resolvedLocale = resolveRequestLocale({
    request,
    localeConfig: localeConfig,
    localeCookieName: localeCookieName,
  });

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = getLocalizedRedirectPathname(
    request.nextUrl.pathname,
    resolvedLocale,
    locales
  );

  const response = NextResponse.redirect(redirectUrl);
  response.headers.set("Vary", "Accept-Language");
  if (isPrivateReservationPath(request.nextUrl.pathname)) {
    privateResponse(response);
  }
  setLocaleCookie(response, localeCookieName, resolvedLocale);
  return response;
}

export const config: MiddlewareConfig = {
  matcher: [
    "/admin/:path*",
    "/((?!api|_next/static|_next/image|favicon.ico|favicon.svg|.*\\..*).*)",
  ],
};
