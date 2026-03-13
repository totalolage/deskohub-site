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
  workspaceLocaleConfig,
  workspaceLocaleCookieName,
  workspaceLocales,
} from "@/features/i18n/routing";

export function proxy(request: NextRequest) {
  const localeFromUrl = getLocaleFromRequestPathname(request, workspaceLocales);

  if (localeFromUrl) {
    const response = NextResponse.next();
    setLocaleCookie(response, workspaceLocaleCookieName, localeFromUrl);
    return response;
  }

  const resolvedLocale = resolveRequestLocale({
    request,
    localeConfig: workspaceLocaleConfig,
    localeCookieName: workspaceLocaleCookieName,
  });

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = getLocalizedRedirectPathname(
    request.nextUrl.pathname,
    resolvedLocale,
    workspaceLocales
  );

  const response = NextResponse.redirect(redirectUrl);
  response.headers.set("Vary", "Accept-Language");
  setLocaleCookie(response, workspaceLocaleCookieName, resolvedLocale);
  return response;
}

export const config: MiddlewareConfig = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|favicon.svg|.*\\..*).*)",
  ],
};
