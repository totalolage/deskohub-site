import {
  resolveLocaleFromPolicy as resolveLocaleFromPolicyShared,
  resolvePreferredLocale,
} from "@deskohub/i18n/core";
import {
  getLocaleFromPathname as getLocaleFromPathnameShared,
  replaceLocaleInPathname,
} from "@deskohub/i18n/pathname";

export const workspaceLocales = ["en-US", "cs-CZ"] as const;

export type WorkspaceLocale = (typeof workspaceLocales)[number];

export const defaultWorkspaceLocale: WorkspaceLocale = "en-US";

export const workspaceLocaleCookieName = "PARAGLIDE_LOCALE";

export const workspaceLocaleConfig = {
  locales: workspaceLocales,
  baseLocale: defaultWorkspaceLocale,
  preferredLanguageToLocale: {
    cs: "cs-CZ",
    en: "en-US",
  },
} as const;

export const isWorkspaceLocale = (value: string): value is WorkspaceLocale =>
  workspaceLocales.includes(value as WorkspaceLocale);

export const getLocaleFromPathname = (
  pathname: string
): WorkspaceLocale | undefined =>
  getLocaleFromPathnameShared(pathname, workspaceLocales);

export const getPreferredLocaleFromAcceptLanguage = (
  headerValue: string | null
): WorkspaceLocale | undefined => {
  return resolvePreferredLocale({
    headerValue,
    locales: workspaceLocaleConfig.locales,
    preferredLanguageToLocale: workspaceLocaleConfig.preferredLanguageToLocale,
  });
};

type ResolveLocaleInput = {
  localeFromUrl?: string;
  localeFromCookie?: string;
  localeFromPreferredLanguage?: WorkspaceLocale;
};

export const resolveLocaleFromPolicy = ({
  localeFromUrl,
  localeFromCookie,
  localeFromPreferredLanguage,
}: ResolveLocaleInput): WorkspaceLocale => {
  return resolveLocaleFromPolicyShared({
    localeFromUrl,
    localeFromCookie,
    localeFromPreferredLanguage,
    locales: workspaceLocaleConfig.locales,
    fallbackLocale: workspaceLocaleConfig.baseLocale,
  });
};

export const withLocalePrefix = (
  pathname: string,
  locale: WorkspaceLocale
): string => replaceLocaleInPathname(pathname, locale, workspaceLocales);
