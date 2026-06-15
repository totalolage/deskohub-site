import type { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import {
  type LocaleConfig,
  resolveLocaleFromPolicy,
  resolvePreferredLocale,
} from "./core";
import {
  getLocaleFromPathname,
  pathnameHasLocale,
  replaceLocaleInPathname,
  stripLocaleFromPathname,
} from "./pathname";

type LocaleList<Locale extends string> = readonly Locale[];

type RequestHeadersLike = Pick<Headers, "get">;
type RequestPathnameLike = { nextUrl: { pathname: string } };
type RequestCookiesLike = {
  cookies: { get: (name: string) => { value: string } | undefined };
};
type ResponseCookiesLike = {
  cookies: {
    set: (name: string, value: string, options?: LocaleCookieOptions) => void;
  };
};

export const PATHNAME_HEADER_NAME = "x-pathname";

export type ChainedMiddleware = (
  request: NextRequest,
  event: NextFetchEvent,
  response?: NextResponse
) =>
  | NextResponse
  | Response
  | null
  | undefined
  | Promise<NextResponse | Response | null | undefined>;

export type MiddlewareFactory = (next: ChainedMiddleware) => ChainedMiddleware;

export function createMiddlewareChain(
  factories: readonly MiddlewareFactory[],
  terminal: ChainedMiddleware,
  index = 0
): ChainedMiddleware {
  const factory = factories[index];
  if (!factory) return terminal;

  return factory((request, event, response) =>
    createMiddlewareChain(factories, terminal, index + 1)(
      request,
      event,
      response
    )
  );
}

export function getLocaleFromRequestPathname<Locale extends string>(
  request: RequestPathnameLike,
  locales: LocaleList<Locale>
): Locale | undefined {
  return getLocaleFromPathname(request.nextUrl.pathname, locales);
}

export function readLocaleCookie(
  request: RequestCookiesLike,
  cookieName: string
): string | undefined {
  return request.cookies.get(cookieName)?.value;
}

type LocaleCookieOptions = {
  path?: string;
  sameSite?: "strict" | "lax" | "none";
};

export function setLocaleCookie<Locale extends string>(
  response: ResponseCookiesLike,
  cookieName: string,
  locale: Locale,
  options: LocaleCookieOptions = {}
): void {
  response.cookies.set(cookieName, locale, {
    path: options.path ?? "/",
    sameSite: options.sameSite ?? "lax",
  });
}

type ResolveRequestLocaleOptions<Locale extends string> = {
  request: RequestPathnameLike &
    RequestCookiesLike & { headers: RequestHeadersLike };
  localeConfig: LocaleConfig<Locale>;
  localeCookieName: string;
};

export function resolveRequestLocale<Locale extends string>({
  request,
  localeConfig,
  localeCookieName,
}: ResolveRequestLocaleOptions<Locale>): Locale {
  const localeFromUrl = getLocaleFromPathname(
    request.nextUrl.pathname,
    localeConfig.locales
  );
  const localeFromCookie = readLocaleCookie(request, localeCookieName);
  const localeFromPreferredLanguage = resolvePreferredLocale({
    headerValue: request.headers.get("accept-language"),
    locales: localeConfig.locales,
    preferredLanguageToLocale: localeConfig.preferredLanguageToLocale,
  });

  return resolveLocaleFromPolicy({
    localeFromUrl,
    localeFromCookie,
    localeFromPreferredLanguage,
    locales: localeConfig.locales,
    fallbackLocale: localeConfig.baseLocale,
  });
}

export function shouldRedirectForMissingLocale<Locale extends string>(
  pathname: string,
  locales: LocaleList<Locale>
): boolean {
  return !pathnameHasLocale(pathname, locales);
}

export function getLocalizedRedirectPathname<Locale extends string>(
  pathname: string,
  locale: Locale,
  locales: LocaleList<Locale>
) {
  return replaceLocaleInPathname(pathname, locale, locales);
}

type PathnameHeaderOptions<Locale extends string> = {
  pathname: string;
  locales: LocaleList<Locale>;
  headerName?: string;
};

export function setPathnameHeader<Locale extends string>(
  headers: Headers,
  options: PathnameHeaderOptions<Locale>
): Headers {
  headers.set(
    options.headerName ?? PATHNAME_HEADER_NAME,
    stripLocaleFromPathname(options.pathname, options.locales)
  );
  return headers;
}

export function createPathnameHeaders<Locale extends string>(
  sourceHeaders: Headers,
  options: PathnameHeaderOptions<Locale>
): Headers {
  const headers = new Headers(sourceHeaders);
  return setPathnameHeader(headers, options);
}

export function readPathnameHeader(
  headers: RequestHeadersLike,
  headerName = PATHNAME_HEADER_NAME
): string | undefined {
  return headers.get(headerName) ?? undefined;
}

export type MiddlewareRequestLike = {
  headers: Headers;
  nextUrl: { pathname: string };
};

export function withPathnameHeaderOnRequest<
  Locale extends string,
  RequestLike extends MiddlewareRequestLike,
>(
  request: RequestLike,
  locales: LocaleList<Locale>,
  headerName?: string
): RequestLike {
  const headers = createPathnameHeaders(request.headers, {
    pathname: request.nextUrl.pathname,
    locales,
    headerName,
  });

  return Object.assign({}, request, { headers });
}

export type MiddlewareHandler = (
  request: NextRequest,
  event: NextFetchEvent
) => Promise<Response | undefined> | Response | undefined;
