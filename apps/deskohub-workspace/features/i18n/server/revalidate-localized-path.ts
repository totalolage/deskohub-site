import { prefixPathnameWithLocale } from "@deskohub/i18n/pathname";
import { revalidatePath } from "next/cache";
import { locales } from "../paraglide/runtime.js";
import type { LocalizedRoute, UnprefixedRoutePath } from "../routing";

/**
 * Revalidates a page path from `getUnprefixedPagePath` (or an alias such as
 * `administrationHref`) in every locale, for a mutation that doesn't know
 * which localized copies of the page are cached.
 */
export const revalidateLocalizedPath = (
  pathname: UnprefixedRoutePath<LocalizedRoute>
) => {
  for (const locale of locales) {
    revalidatePath(prefixPathnameWithLocale(pathname, locale));
  }
};
