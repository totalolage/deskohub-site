import { localeUrl } from "./locale-url";

export function getLocaleFromReferer(headers: Readonly<Headers>) {
  const referer = headers.get("referer");
  const refererLocale = referer && localeUrl.get(referer);
  if (refererLocale) return refererLocale;
}
