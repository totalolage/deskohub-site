import type { RequestCookies } from "next/dist/compiled/@edge-runtime/cookies";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { isLocale } from "../paraglide/runtime";

export function getLocaleFromCookie(
  cookies: ReadonlyRequestCookies | RequestCookies
) {
  const localeCookie = cookies.get("PARAGLIDE_LOCALE")?.value;
  if (isLocale(localeCookie)) return localeCookie;
}
