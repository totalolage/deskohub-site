import { updateLocalePreference } from "@/features/account/actions";
import {
  getAccountPath,
  getAccountSignInPath,
} from "@/features/account/routes";
import { isCustomerSignedIn } from "@/features/account/server/customer-session.server";
import type { LocalePreferenceSaving } from "@/features/account/switch-locale";
import { isCurrentAccountAdministrator } from "@/features/administrators/server/current-account-administrator.server";
import { type Locale, m } from "@/features/i18n";
import { getLanguageLabels } from "@/features/i18n/language-labels";
import { isMeetingRoomPageEnabled } from "@/features/meeting-room/backend/meeting-room-page-feature-flag";
import { isOfficePageEnabled } from "@/features/office/backend/office-reservation-feature-flag.server";
import {
  getCoworkReservationPath,
  getOfficeReservationPath,
} from "@/features/reservation/routes";

const siteHeaderSectionIds = {
  overview: "overview",
  ttrpg: "ttrpg",
  events: "events",
  locationMap: "location-map",
} as const;

type SiteHeaderMenuItemId =
  | "locationMap"
  | "coworking"
  | "meetingRoom"
  | "office"
  | "pricing"
  | "gallery"
  | "team"
  | "faq"
  | "contact";

export type SiteHeaderMenuItem = {
  readonly id: SiteHeaderMenuItemId;
  readonly label: string;
  readonly href: string;
};

export type SiteHeaderAccountEntry = {
  readonly label: string;
  /** Account page for a signed-in customer, otherwise the sign-in page. */
  readonly href: Promise<string>;
  /** Shown while the session check is still pending. */
  readonly signInHref: string;
};

export type SiteHeaderAdministratorEntry = {
  /** True only for a signed-in administrator; customers never see the entry. */
  readonly visible: Promise<boolean>;
  readonly href: string;
  readonly label: string;
};

type DisabledSiteHeaderMenuItems = Partial<
  Record<SiteHeaderMenuItemId, boolean>
>;

export const getSiteHeaderAccessibilityLabels = (locale: Locale) => ({
  closeNavigationMenuLabel: m.closeNavigationMenuLabel({}, { locale }),
  languageSwitcherLabel: m.languageSwitcherLabel({}, { locale }),
  mobilePrimaryNavigationLabel: m.mobilePrimaryNavigationLabel({}, { locale }),
  openNavigationMenuLabel: m.openNavigationMenuLabel({}, { locale }),
  primaryNavigationLabel: m.primaryNavigationLabel({}, { locale }),
});

export async function getSiteHeaderConfig(locale: Locale) {
  const [meetingRoomPageEnabled, officePageEnabled] = await Promise.all([
    isMeetingRoomPageEnabled(),
    isOfficePageEnabled(),
  ]);

  return createSiteHeaderConfig(locale, {
    disabledMenuItems: {
      meetingRoom: !meetingRoomPageEnabled,
      office: !officePageEnabled,
    },
  });
}

const createSiteHeaderConfig = (
  locale: Locale,
  {
    disabledMenuItems,
  }: {
    readonly disabledMenuItems: DisabledSiteHeaderMenuItems;
  }
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
      id: "coworking",
      label: m.landingNavCoworking({}, { locale }),
      href: `${localePath}/coworking`,
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
      id: "pricing",
      label: m.landingNavPricing({}, { locale }),
      href: `${localePath}/pricing`,
    },
    {
      id: "gallery",
      label: m.landingNavGallery({}, { locale }),
      href: `${localePath}/gallery`,
    },
    {
      id: "team",
      label: m.landingNavOurTeam({}, { locale }),
      href: `${localePath}/team`,
    },
    {
      id: "faq",
      label: m.landingNavFaq({}, { locale }),
      href: `${localePath}/faq`,
    },
    {
      id: "contact",
      label: m.landingNavContactLabel({}, { locale }),
      href: `${localePath}/contact`,
    },
  ] satisfies SiteHeaderMenuItem[];

  return {
    ...getSiteHeaderAccessibilityLabels(locale),
    account: createSiteHeaderAccountEntry(locale),
    administrator: createSiteHeaderAdministratorEntry(locale),
    localePreference: createLocalePreferenceSaving(),
    languageLabels: getLanguageLabels(locale),
    links: links.filter(({ id }) => disabledMenuItems[id] !== true),
    contactLabel: m.reservationNavCta({}, { locale }),
    contactHref: getCoworkReservationPath(locale),
  };
};

// Not awaited: the header streams the resolved link while the sign-in link
// stays in the static shell.
const createSiteHeaderAccountEntry = (
  locale: Locale
): SiteHeaderAccountEntry => ({
  label: m.accountNavLabel({}, { locale }),
  href: isCustomerSignedIn().then(
    (signedIn) =>
      signedIn ? getAccountPath(locale) : getAccountSignInPath(locale),
    () => getAccountSignInPath(locale)
  ),
  signInHref: getAccountSignInPath(locale),
});

// Not awaited, like the account entry: the static shell renders without it and
// a failed check hides it.
const createSiteHeaderAdministratorEntry = (
  locale: Locale
): SiteHeaderAdministratorEntry => ({
  visible: isCurrentAccountAdministrator().catch(() => false),
  href: `/${locale}/admin`,
  label: m.siteHeaderAdminLabel({}, { locale }),
});

// Not awaited, like the account entry: the switcher learns after the shell
// whether a switch must save the signed-in customer's preference.
export const createLocalePreferenceSaving = (): LocalePreferenceSaving => ({
  signedIn: isCustomerSignedIn().catch(() => false),
  save: updateLocalePreference,
});

export { siteHeaderSectionIds };
