import { isLocale } from "../paraglide/runtime";

export function getLocaleFromAcceptLanguage(headers: Readonly<Headers>) {
  const acceptLanguage = headers.get("accept-language");
  const languages = acceptLanguage
    ?.split(",")
    .map((locale) => {
      const parts = locale.split(";")[0]?.trim().split("-");
      return parts?.[0];
    })
    .filter((lang): lang is string => lang !== undefined);
  const headerLocale = languages?.find(isLocale);
  if (headerLocale) return headerLocale;
}
