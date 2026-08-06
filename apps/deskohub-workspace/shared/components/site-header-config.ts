import { type Locale, m } from "@/features/i18n";
import { isMeetingRoomPageEnabled } from "@/features/meeting-room/backend/meeting-room-page-feature-flag";
import { isOfficePageEnabled } from "@/features/office/backend/office-reservation-feature-flag.server";
import {
  getCoworkReservationPath,
  getOfficeReservationPath,
} from "@/features/reservation/routes";

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

export async function getSiteHeaderConfig(locale: Locale) {
  const [meetingRoomPageEnabled, officePageEnabled] = await Promise.all([
    isMeetingRoomPageEnabled(),
    isOfficePageEnabled(),
  ]);
  const localePath = `/${locale}`;
  const localizedHash = (hash: string) => `${localePath}${hash}`;

  return {
    languageLabels: getSiteHeaderLanguageLabels(locale),
    links: [
      {
        label: m.landingNavWhereToFindUs({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.locationMap}`),
      },
      meetingRoomPageEnabled && {
        label: m.landingNavMeetingRoom({}, { locale }),
        href: `${localePath}/meeting-room`,
      },
      officePageEnabled && {
        label: m.landingNavPrivateOffice({}, { locale }),
        href: getOfficeReservationPath(locale),
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
    contactHref: getCoworkReservationPath(locale),
  };
}

export { siteHeaderSectionIds };
