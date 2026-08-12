import Constants from "expo-constants";

import type { Locale } from "@/src/domain/shop";

type PublicPage = "account" | "privacy-policy" | "terms-and-conditions";

const extra = (Constants.expoConfig?.extra ?? {}) as {
  siteOrigin?: string;
};

const siteOrigin = extra.siteOrigin?.trim() || "https://workspace.deskohub.cz";

const configuredVersion =
  Constants.expoConfig?.version?.trim() || "development";

export const appVersion =
  configuredVersion.length > 16
    ? configuredVersion.slice(0, 8)
    : configuredVersion;

export function getPublicPageUrl(locale: Locale, page: PublicPage): string {
  const localePath = locale === "cs" ? "cs-CZ" : "en-US";
  return new URL(`/${localePath}/${page}`, siteOrigin).toString();
}
