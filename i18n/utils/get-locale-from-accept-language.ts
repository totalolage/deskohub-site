import { isLocale } from "../paraglide/runtime";

export function getLocaleFromAcceptLanguage(headers: Readonly<Headers>) {
  const acceptLanguage = headers.get("accept-language");
  const languages = acceptLanguage
    ?.split(",")
    .map((lang) => lang.split(";")[0].trim().split("-")[0]);
  const headerLocale = languages?.find(isLocale);
  if (headerLocale) return headerLocale;
}
