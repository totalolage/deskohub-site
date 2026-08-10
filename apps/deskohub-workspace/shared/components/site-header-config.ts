import { type Locale, m } from "@/features/i18n";
import { isMeetingRoomPageEnabled } from "@/features/meeting-room/backend/meeting-room-page-feature-flag";
import { getCoworkReservationPath } from "@/features/reservation/routes";

const siteHeaderSectionIds = {
  overview: "overview",
  teambuildings: "teambuildings",
  ttrpg: "ttrpg",
  events: "events",
  founders: "founders",
  locationMap: "location-map",
  faqContact: "faq-contact",
} as const;

export type SiteHeaderMenuItemId =
  | "locationMap"
  | "meetingRoom"
  | "gallery"
  | "founders"
  | "faqContact"
  | "contact";

export type SiteHeaderMenuItem = {
  readonly id: SiteHeaderMenuItemId;
  readonly label: string;
  readonly href: string;
};

export type DisabledSiteHeaderMenuItems = Partial<
  Record<SiteHeaderMenuItemId, boolean>
>;

const meetingRoomDisabled: DisabledSiteHeaderMenuItems = {
  meetingRoom: true,
};

export const getSiteHeaderLanguageLabels = (
  locale: Locale
): Record<Locale, string> => ({
  "cs-CZ": m.languageCzech({}, { locale }),
  "en-US": m.languageEnglish({}, { locale }),
});

export async function getSiteHeaderConfig(locale: Locale) {
  const meetingRoomPageEnabled = await isMeetingRoomPageEnabled();

  return createSiteHeaderConfig(locale, {
    meetingRoom: !meetingRoomPageEnabled,
  });
}

export const getSiteHeaderShellConfig = (locale: Locale) =>
  createSiteHeaderConfig(locale, meetingRoomDisabled);

const createSiteHeaderConfig = (
  locale: Locale,
  disabledMenuItems: DisabledSiteHeaderMenuItems
) => {
  const localePath = `/${locale}`;
  const localizedHash = (hash: string) => `${localePath}${hash}`;

  return {
    languageLabels: getSiteHeaderLanguageLabels(locale),
    links: [
      {
        id: "locationMap",
        label: m.landingNavWhereToFindUs({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.locationMap}`),
      },
      {
        id: "meetingRoom",
        label: m.landingNavMeetingRoom({}, { locale }),
        href: `${localePath}/meeting-room`,
      },
      {
        id: "gallery",
        label: m.landingNavGallery({}, { locale }),
        href: `${localePath}/gallery`,
      },
      {
        id: "founders",
        label: m.landingNavOurTeam({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.founders}`),
      },
      {
        id: "faqContact",
        label: m.landingNavFaqContact({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.faqContact}`),
      },
      {
        id: "contact",
        label: m.landingNavContactLabel({}, { locale }),
        href: `${localePath}/contact`,
      },
    ] satisfies SiteHeaderMenuItem[],
    disabledMenuItems,
    contactLabel: m.reservationNavCta({}, { locale }),
    contactHref: getCoworkReservationPath(locale),
  };
};

export { siteHeaderSectionIds };
