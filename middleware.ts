import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { baseLocale, Locale, locales } from "./i18n";

// Get the preferred locale from Accept-Language header or other sources
function getLocale(request: NextRequest): string {
  // Check Accept-Language header
  const acceptLanguage = request.headers.get("accept-language");
  if (acceptLanguage) {
    const languages = acceptLanguage
      .split(",")
      .map((lang) => lang.split(";")[0].trim().split("-")[0]);

    for (const lang of languages) {
      if (locales.includes(lang as Locale)) {
        return lang;
      }
    }
  }

  return baseLocale;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Handle root path by redirecting to user's preferred language
  if (pathname === "/") {
    const locale = getLocale(request);

    // If user prefers Czech (default), redirect to /cs for consistency
    // If user prefers another language, redirect to that language path
    const redirectUrl = new URL(`/${locale}`, request.url);
    return NextResponse.redirect(redirectUrl);
  }

  // Check if pathname already has a locale
  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`,
  );
  if (pathnameHasLocale) return NextResponse.next();

  // Redirect if there is no locale in the pathname
  const locale = getLocale(request);

  // For any path without locale, redirect to the user's preferred language
  const redirectUrl = new URL(`/${locale}${pathname}`, request.url);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: [
    // Skip all internal paths (_next)
    "/((?!_next|api|favicon.ico|icon.ico|apple-icon|images|.*\\.ico$).*)",
  ],
};
