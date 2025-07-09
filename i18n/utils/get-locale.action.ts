import { cookies, headers } from "next/headers";
import { getLocaleFromAcceptLanguage } from "./get-locale-from-accept-language";
import { getLocaleFromCookie } from "./get-locale-from-cookie";
import { getLocaleFromReferer } from "./get-locale-from-referer";

export async function getLocaleFromAction() {
  const h = await headers();
  const c = await cookies();
  return (
    getLocaleFromReferer(h) ||
    getLocaleFromCookie(c) ||
    getLocaleFromAcceptLanguage(h)
  );
}
