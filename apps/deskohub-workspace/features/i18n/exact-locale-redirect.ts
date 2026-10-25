import { findExactLocalePathname } from "@deskohub/i18n/pathname";
import { NextResponse } from "next/server";
import { localeConfig, locales } from "./routing";

// A page load whose locale prefix is in another letter case (`/en-us`) or a
// bare language (`/en`, `/sk`) moves permanently to the exact locale, whoever
// asks.
export const exactLocaleRedirect = (method: string, url: URL) => {
  if (method !== "GET" && method !== "HEAD") return undefined;
  const exactPathname = findExactLocalePathname(
    url.pathname,
    locales,
    localeConfig.preferredLanguageToLocale
  );
  if (!exactPathname) return undefined;

  const exactUrl = new URL(url);
  exactUrl.pathname = exactPathname;
  return NextResponse.redirect(exactUrl, 308);
};
