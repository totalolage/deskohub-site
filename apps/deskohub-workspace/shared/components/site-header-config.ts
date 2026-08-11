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

export type SiteHeaderMenuItemId =
  | "locationMap"
  | "meetingRoom"
  | "office"
  | "gallery"
  | "founders"
  | "faqContact"
  | "contact";

export type SiteHeaderMenuItem = {
  readonly id: SiteHeaderMenuItemId;
  readonly label: string;
  readonly href: string;
};

type DisabledSiteHeaderMenuItems = Partial<
  Record<SiteHeaderMenuItemId, boolean>
>;

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

  return createSiteHeaderConfig(locale, {
    meetingRoom: !meetingRoomPageEnabled,
    office: !officePageEnabled,
  });
}

const createSiteHeaderConfig = (
  locale: Locale,
  disabledMenuItems: DisabledSiteHeaderMenuItems
) => {
  const localePath = `/${locale}`;
  const localizedHash = (hash: string) => `${localePath}${hash}`;
  const links = [
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
      id: "office",
      label: m.landingNavPrivateOffice({}, { locale }),
      href: getOfficeReservationPath(locale),
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
  ] satisfies SiteHeaderMenuItem[];

  return {
    languageLabels: getSiteHeaderLanguageLabels(locale),
    links: links.filter(({ id }) => disabledMenuItems[id] !== true),
    accountLabel: m.accountNavLabel({}, { locale }),
    accountHref: `${localePath}/account`,
    contactLabel: m.reservationNavCta({}, { locale }),
    contactHref: getCoworkReservationPath(locale),
  };
};

export { siteHeaderSectionIds };
