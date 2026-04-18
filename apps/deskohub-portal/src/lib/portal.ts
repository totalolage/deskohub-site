import { type Locale, locales, m } from "../../features/i18n";

export const portalOrigin = "https://www.deskohub.cz";

export type PortalAlternateLink = {
  href: string;
  hrefLang: Locale;
};

export type PortalMetadata = {
  alternateDefaultUrl: string;
  alternates: PortalAlternateLink[];
  canonicalUrl: string;
  lang: Locale;
  metaDescription: string;
  title: string;
};

export function getLocalizedPortalUrl(locale: Locale) {
  return `${portalOrigin}/${locale}/`;
}

export function getPortalMetadata(locale: Locale): PortalMetadata {
  return {
    alternateDefaultUrl: `${portalOrigin}/`,
    alternates: locales.map((alternateLocale) => ({
      href: getLocalizedPortalUrl(alternateLocale),
      hrefLang: alternateLocale,
    })),
    canonicalUrl: getLocalizedPortalUrl(locale),
    lang: locale,
    metaDescription: m.portalMetaDescription({}, { locale }),
    title: m.portalTitle({}, { locale }),
  };
}
