import Cookies from "js-cookie";
import { useParams, usePathname } from "next/navigation";
import type { RouteParams_locale } from "@/app/[locale]/route";
import { getLocale, isLocale, type Locale } from "../paraglide/runtime";
import { getLocaleFromPathname } from "./locale-url";

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
