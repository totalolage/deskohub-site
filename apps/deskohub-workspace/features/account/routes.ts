import {
  type AccountSection,
  defaultAccountSection,
  isAccountSection,
} from "@/features/account/sections";
import {
  getLocalizedDynamicPagePath,
  getLocalizedPagePath,
  type Locale,
} from "@/features/i18n";

export const getAccountPath = (locale: Locale) =>
  getLocalizedPagePath(locale, "/[locale]/account");

export const getAccountSignInPath = (locale: Locale) =>
  getLocalizedPagePath(locale, "/[locale]/auth/sign-in");

export const getAccountSectionPath = (
  locale: Locale,
  section: AccountSection
) =>
  section === "legal"
    ? getLocalizedPagePath(locale, "/[locale]/account/legal")
    : getLocalizedDynamicPagePath(locale, "/[locale]/account/[section]", {
        section,
      });

const withoutTrailingSlashes = (pathname: string) =>
  pathname.replace(/\/+$/, "");

/** Whether a pathname is the bare account path, without a section. */
export const isAccountPathname = (locale: Locale, pathname: string) =>
  withoutTrailingSlashes(pathname) === getAccountPath(locale);

/**
 * The section an account pathname shows: the default section on the bare
 * account path, nothing outside the sections (such as the deleted page).
 */
export const findAccountSectionOfPathname = (
  locale: Locale,
  pathname: string
): AccountSection | undefined => {
  if (isAccountPathname(locale, pathname)) return defaultAccountSection;
  const accountPath = getAccountPath(locale);
  const normalizedPathname = withoutTrailingSlashes(pathname);
  if (!normalizedPathname.startsWith(`${accountPath}/`)) return undefined;

  const segment = normalizedPathname.slice(accountPath.length + 1);
  return isAccountSection(segment) ? segment : undefined;
};

const legacySectionParam = "section";

/**
 * Where a retired `/[locale]/account?section=<section>` link now leads: the
 * section's own path, or the account itself for an unknown section. Other
 * query parameters stay. Any other URL has no redirect.
 */
export const findLegacyAccountSectionRedirect = (
  locale: Locale,
  url: URL
): URL | undefined => {
  if (
    withoutTrailingSlashes(url.pathname) !== getAccountPath(locale) ||
    !url.searchParams.has(legacySectionParam)
  ) {
    return undefined;
  }

  const section = url.searchParams.get(legacySectionParam) ?? "";
  const redirectUrl = new URL(url);
  redirectUrl.searchParams.delete(legacySectionParam);
  redirectUrl.pathname = isAccountSection(section)
    ? getAccountSectionPath(locale, section)
    : getAccountPath(locale);
  return redirectUrl;
};
