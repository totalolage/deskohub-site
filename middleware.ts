import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getLocaleFromPathname } from "./i18n/utils/get-locale-from-pathname";
import { getLocaleFromEdge } from "./i18n/utils/get-locale.edge";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if pathname already has a locale
  const pathnameHasLocale = !!getLocaleFromPathname(pathname);
  if (pathnameHasLocale) return NextResponse.next();

  // Redirect if there is no locale in the pathname
  const locale = getLocaleFromEdge(request);

  // For any path without locale, redirect to the user's preferred language
  const redirectUrl = new URL(`/${locale}${pathname}`, request.url);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: [
    // Skip all internal paths (_next)
    "/((?!_next|api|favicon.ico|icon.ico|apple-icon|images|.*\\.ico$|.well-known).*)",
  ],
};
