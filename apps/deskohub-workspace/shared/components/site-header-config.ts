import { type Locale, m } from "@/features/i18n";

const siteHeaderSectionIds = {
  overview: "overview",
  teambuildings: "teambuildings",
  ttrpg: "ttrpg",
  events: "events",
  founders: "founders",
  locationMap: "location-map",
  faqContact: "faq-contact",
} as const;

export const getSiteHeaderLanguageLabels = (
  locale: Locale
): Record<Locale, string> => ({
  "cs-CZ": m.languageCzech({}, { locale }),
  "en-US": m.languageEnglish({}, { locale }),
});

export function getSiteHeaderConfig(
  locale: Locale,
  options: { readonly meetingRoomPageEnabled: boolean }
) {
  const localePath = `/${locale}`;
  const localizedHash = (hash: string) => `${localePath}${hash}`;

  return {
    languageLabels: getSiteHeaderLanguageLabels(locale),
    links: [
      {
        label: m.landingNavWhereToFindUs({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.locationMap}`),
      },
      options.meetingRoomPageEnabled && {
        label: m.landingNavMeetingRoom({}, { locale }),
        href: `${localePath}/meeting-room`,
      },
      {
        label: m.landingNavGallery({}, { locale }),
        href: `${localePath}/gallery`,
      },
      {
        label: m.landingNavOurTeam({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.founders}`),
      },
      {
        label: m.landingNavFaqContact({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.faqContact}`),
      },
      {
        label: m.landingNavContactLabel({}, { locale }),
        href: `${localePath}/contact`,
      },
    ].filter(Boolean),
    contactLabel: m.reservationNavCta({}, { locale }),
    contactHref: `${localePath}/checkout/order`,
  };
}

export { siteHeaderSectionIds };
