import type { NextRequest } from "next/server";
import { baseLocale } from "../paraglide/runtime";
import { getLocaleFromAcceptLanguage } from "./get-locale-from-accept-language";
import { getLocaleFromCookie } from "./get-locale-from-cookie";
import { localeUrl } from "./locale-url";
import { getLocaleFromReferer } from "./get-locale-from-referer";

export function getLocaleFromEdge(request: NextRequest) {
  return (
    localeUrl.get(request.nextUrl.pathname) ||
    getLocaleFromReferer(request.headers) ||
    getLocaleFromCookie(request.cookies) ||
    getLocaleFromAcceptLanguage(request.headers) ||
    baseLocale
  );
}
