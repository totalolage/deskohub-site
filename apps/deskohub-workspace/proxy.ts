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

export function proxy(request: NextRequest) {
  const localeFromUrl = getLocaleFromRequestPathname(request, locales);

  if (localeFromUrl) {
    const response = NextResponse.next();
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
    "/((?!api|_next/static|_next/image|favicon.ico|favicon.svg|.*\\..*).*)",
  ],
};
