import { locales } from "../paraglide/runtime";
import { tryOrElse } from "@/lib/utils";

export function getLocaleFromPathname(url: string) {
  const pathname = tryOrElse(
    () => new URL(url).pathname,
    () => url,
  );
  return locales.find((locale) => pathname.startsWith(`/${locale}`));
}
