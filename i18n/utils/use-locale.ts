import Cookies from "js-cookie";
import { useParams, usePathname } from "next/navigation";
import type { RouteParams_locale } from "@/app/[locale]/route";
import { getLocaleFromPathname } from "./get-locale-from-pathname";
import { getLocale, isLocale, Locale } from "../paraglide/runtime";

export function useLocale(): Locale {
  const params = useParams<Partial<RouteParams_locale>>();
  const pathname = usePathname();

  if (isLocale(params.locale)) return params.locale;

  const localeFromPathname = getLocaleFromPathname(pathname);
  if (isLocale(localeFromPathname)) return localeFromPathname;

  const localeFromCookie = Cookies.get("PARAGLIDE_LOCALE");
  if (isLocale(localeFromCookie)) return localeFromCookie;

  return getLocale();
}
