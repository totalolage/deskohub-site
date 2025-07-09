import { getLocaleFromPathname } from "./get-locale-from-pathname";

export function getLocaleFromReferer(headers: Readonly<Headers>) {
  const referer = headers.get("referer");
  const refererLocale = referer && getLocaleFromPathname(referer);
  if (refererLocale) return refererLocale;
}
