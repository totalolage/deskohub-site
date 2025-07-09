import { NextRequest } from "next/server";
import { getLocaleFromPathname } from "./get-locale-from-pathname";
import { getLocaleFromReferer } from "./get-locale-from-referer";
import { getLocaleFromCookie } from "./get-locale-from-cookie";
import { getLocaleFromAcceptLanguage } from "./get-locale-from-accept-language";

export function getLocaleFromRequest(request: NextRequest) {
  return (
    getLocaleFromPathname(request.nextUrl.pathname) ||
    getLocaleFromReferer(request.headers) ||
    getLocaleFromCookie(request.cookies) ||
    getLocaleFromAcceptLanguage(request.headers)
  );
}
