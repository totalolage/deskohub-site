import { isLocale, Locale, getLocale } from "../paraglide/runtime";
import { useParams, usePathname } from "next/navigation";
import { RouteParams } from "@/app/[lang]/route";
import Cookies from "js-cookie";
import { getLocaleFromPathname } from "./get-locale-from-pathname";

export function useLocale(): Locale {
  const { lang: langFromParams } = useParams<Partial<RouteParams>>();
  if (isLocale(langFromParams)) return langFromParams;

  const langFromPathname = getLocaleFromPathname(usePathname());
  if (isLocale(langFromPathname)) return langFromPathname;

  const langFromCookie = Cookies.get("PARAGLIDE_LOCALE");
  if (isLocale(langFromCookie)) return langFromCookie;

  return getLocale();
}
