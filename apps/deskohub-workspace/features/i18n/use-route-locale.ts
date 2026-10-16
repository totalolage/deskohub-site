import { useParams } from "next/navigation";
import { baseLocale, isLocale, type Locale } from "./paraglide/runtime.js";

/** The `[locale]` segment of the current route, for client components. */
export const useRouteLocale = (): Locale => {
  const locale = useParams<{ locale?: string }>()?.locale;
  return isLocale(locale) ? locale : baseLocale;
};
