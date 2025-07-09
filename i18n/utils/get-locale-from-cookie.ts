import { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { isLocale } from "../paraglide/runtime";
import { RequestCookies } from "next/dist/compiled/@edge-runtime/cookies";

export function getLocaleFromCookie(cookies: ReadonlyRequestCookies | RequestCookies) {
  const localeCookie = cookies.get("PARAGLIDE_LOCALE")?.value;
  if (isLocale(localeCookie)) return localeCookie;
}
