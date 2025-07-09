import { cookies, headers } from "next/headers";
import { getLocaleFromAcceptLanguage } from "./get-locale-from-accept-language";
import { getLocaleFromCookie } from "./get-locale-from-cookie";
import { getLocaleFromReferer } from "./get-locale-from-referer";
import { baseLocale } from "../paraglide/runtime";

export async function getLocaleFromServer() {
  const h = await headers();
  const c = await cookies();
  return (
    getLocaleFromReferer(h) ||
    getLocaleFromCookie(c) ||
    getLocaleFromAcceptLanguage(h) ||
    baseLocale
  );
}
