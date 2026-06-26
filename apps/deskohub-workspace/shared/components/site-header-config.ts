import { type Locale, m } from "@/features/i18n";

const siteHeaderSectionIds = {
  overview: "overview",
  teambuildings: "teambuildings",
  ttrpg: "ttrpg",
  events: "events",
  cowork: "cowork",
  locationMap: "location-map",
  privateOffice: "private-office",
  faqContact: "faq-contact",
} as const;

export function getSiteHeaderConfig(locale: Locale) {
  const localePath = `/${locale}`;
  const localizedHash = (hash: string) => `${localePath}${hash}`;

  return {
    languageLabels: {
      "cs-CZ": m.languageCzech({}, { locale }),
      "en-US": m.languageEnglish({}, { locale }),
    } satisfies Record<Locale, string>,
    links: [
      {
        label: m.landingNavWhereToFindUs({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.locationMap}`),
      },
      {
        label: m.landingNavTtrpg({}, { locale }),
        href: `${localePath}/ttrpg-room`,
      },
      {
        label: m.landingNavGallery({}, { locale }),
        href: `${localePath}/gallery`,
      },
      {
        label: m.landingNavFaqContact({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.faqContact}`),
      },
      {
        label: m.landingNavContactLabel({}, { locale }),
        href: `${localePath}/contact`,
      },
    ],
    contactLabel: m.reservationNavCta({}, { locale }),
    contactHref: `${localePath}/checkout/order`,
  };
}

export { siteHeaderSectionIds };
