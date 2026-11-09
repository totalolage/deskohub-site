import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";
import { isLocale, type Locale } from "../paraglide/runtime.js";
import { requestLocaleScope } from "./request-locale-scope";

/**
 * The locale of the page being rendered. The proxy has already redirected
 * every page request onto the URL the Workspace locale chain resolves, so the
 * route segment is that chain's result.
 */
export async function getRequestLocale() {
  const locale = await rootLocale();
  if (!isLocale(locale)) notFound();

  return locale;
}

export async function runWithRequestLocale<T>(
  resolve: (locale: Locale) => T | Promise<T>
) {
  const locale = await getRequestLocale();

  return requestLocaleScope.runWithLocale(locale, () => resolve(locale));
}
