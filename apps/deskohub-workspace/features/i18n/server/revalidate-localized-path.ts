import { prefixPathnameWithLocale } from "@deskohub/i18n/pathname";
import { revalidatePath } from "next/cache";
import { locales } from "../paraglide/runtime.js";

/**
 * Revalidates an unprefixed page path in every locale, for a mutation that
 * doesn't know which localized copies of the page are cached.
 */
export const revalidateLocalizedPath = (pathname: string) => {
  for (const locale of locales) {
    revalidatePath(prefixPathnameWithLocale(pathname, locale));
  }
};
