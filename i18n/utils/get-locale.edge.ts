import type { NextRequest } from "next/server";
import { getLocaleFromAcceptLanguage } from "./get-locale-from-accept-language";
import { getLocaleFromCookie } from "./get-locale-from-cookie";
import { getLocaleFromPathname } from "./get-locale-from-pathname";
import { getLocaleFromReferer } from "./get-locale-from-referer";
import { baseLocale } from "../paraglide/runtime";

export function getLocaleFromEdge(request: NextRequest) {
  return (
    getLocaleFromPathname(request.nextUrl.pathname) ||
    getLocaleFromReferer(request.headers) ||
    getLocaleFromCookie(request.cookies) ||
    getLocaleFromAcceptLanguage(request.headers) ||
    baseLocale
  );
}
