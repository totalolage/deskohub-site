import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getLocaleFromEdge } from "./i18n/utils/get-locale.edge";
import { localeUrl } from "./i18n/utils/locale-url";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if pathname already has a locale
  const pathnameHasLocale = !!localeUrl.get(pathname);
  if (pathnameHasLocale) return NextResponse.next();

  // Redirect if there is no locale in the pathname
  const locale = getLocaleFromEdge(request);

  // For any path without locale, redirect to the user's preferred language
  const localizedPath = localeUrl.set(pathname, locale);
  const redirectUrl = new URL(localizedPath, request.url);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: [
    // Skip all internal paths (_next)
    "/((?!_next|api|favicon.ico|icon.ico|apple-icon|images|.*\\.ico$|.well-known).*)",
  ],
};
