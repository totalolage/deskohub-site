import { tryOrElse } from "@/shared/utils";
import { locales } from "../paraglide/runtime";

export function getLocaleFromPathname(url: string) {
  const pathname = tryOrElse(
    () => new URL(url).pathname,
    () => url
  );
  return locales.find((locale) => pathname.startsWith(`/${locale}`));
}
