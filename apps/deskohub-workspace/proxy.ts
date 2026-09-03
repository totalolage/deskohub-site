import {
  getLocaleFromRequestPathname,
  getLocalizedRedirectPathname,
  resolveRequestLocale,
  setLocaleCookie,
} from "@deskohub/i18n/next";
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
import { isDiscountAdminAuthorizationValid } from "./features/discounts/admin/basic-auth";

const isAdministrationPath = (pathname: string) =>
  pathname === "/admin" || pathname.startsWith("/admin/");

const isPrivateReservationPath = (pathname: string) =>
  pathname.includes("/reservation/status/") ||
  pathname.includes("/reservation/access/") ||
  pathname.includes("/reservation/invoice/");

const isPrivateAccountPath = (pathname: string) =>
  /\/account(\/|$)/.test(pathname) || /\/auth(\/|$)/.test(pathname);

export function proxy(request: NextRequest) {
  if (isAdministrationPath(request.nextUrl.pathname)) {
    if (
      !isDiscountAdminAuthorizationValid(
        request.headers.get("authorization"),
        env.ADMIN_BASIC_AUTH_SHA256
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
    const response = NextResponse.next();
    if (
      isPrivateReservationPath(request.nextUrl.pathname) ||
      isPrivateAccountPath(request.nextUrl.pathname)
    ) {
      response.headers.set("Cache-Control", "private, no-store");
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
  setLocaleCookie(response, localeCookieName, resolvedLocale);
  return response;
}

export const config: MiddlewareConfig = {
  matcher: [
    "/admin/:path*",
    "/((?!api|_next/static|_next/image|favicon.ico|favicon.svg|.*\\..*).*)",
  ],
};
