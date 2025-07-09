import Cookies from "js-cookie";
import { useParams, usePathname } from "next/navigation";
import type { RouteParams_lang } from "@/app/[lang]/route";
import { getLocale, isLocale, type Locale } from "../paraglide/runtime";
import { getLocaleFromPathname } from "./get-locale-from-pathname";

export function useLocale(): Locale {
  const params = useParams<Partial<RouteParams_lang>>();
  const pathname = usePathname();

  if (isLocale(params.lang)) return params.lang;

  const langFromPathname = getLocaleFromPathname(pathname);
  if (isLocale(langFromPathname)) return langFromPathname;

  const langFromCookie = Cookies.get("PARAGLIDE_LOCALE");
  if (isLocale(langFromCookie)) return langFromCookie;

  return getLocale();
}
