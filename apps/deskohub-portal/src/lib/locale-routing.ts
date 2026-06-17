import { baseLocale, type Locale } from "../../features/i18n";
import {
  assertIsLocale,
  cookieMaxAge,
  cookieName,
  extractLocaleFromHeader,
  isLocale,
} from "../../features/i18n/paraglide/runtime.js";

const redirectCacheControl = "private, no-store, max-age=0";

export function createLocaleRedirectResponse(request: Request): Response {
  const requestUrl = new URL(request.url);
  const locale = resolveRequestLocale(request);
  const redirectUrl = new URL(`/${locale}/`, request.url);
  redirectUrl.search = requestUrl.search;

  return new Response(null, {
    status: 307,
    headers: {
      "cache-control": redirectCacheControl,
      location: redirectUrl.href,
      "set-cookie": createLocaleCookieHeader(locale),
      vary: "Accept-Language, Cookie",
    },
  });
}

export function createLocaleCookieHeader(locale: Locale) {
  return `${cookieName}=${locale}; Max-Age=${cookieMaxAge}; Path=/; SameSite=Lax`;
}

export function resolveRequestLocale(request: Request): Locale {
  const cookieLocale = getLocaleFromCookie(request.headers.get("cookie"));

  if (cookieLocale) {
    return cookieLocale;
  }

  const headerLocale = extractLocaleFromHeader(request);

  if (headerLocale && isLocale(headerLocale)) {
    return assertIsLocale(headerLocale);
  }

  return baseLocale;
}

function getLocaleFromCookie(cookieHeader: string | null): Locale | null {
  if (!cookieHeader) {
    return null;
  }

  for (const cookieEntry of cookieHeader.split(/;\s*/)) {
    const [cookieKey, ...cookieValueParts] = cookieEntry.split("=");

    if (cookieKey !== cookieName) {
      continue;
    }

    const localeValue = cookieValueParts.join("=");

    if (!localeValue || !isLocale(localeValue)) {
      return null;
    }

    return assertIsLocale(localeValue);
  }

  return null;
}
