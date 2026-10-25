import { type Locale, m } from "@/features/i18n";
import { getMeetingRoomReservationPath } from "@/features/reservation/routes";
import { getDeskohubBarPageUrl } from "@/shared/utils";

const getContactHref = (href: string, message: string) => {
  const searchParams = new URLSearchParams({ message });

  return `${href}?${searchParams.toString()}#contact-form`;
};

/**
 * The TTRPG rooms the page compares, in page order. A Bar room is requested
 * through the Bar's contact form; the Workspace room books the meeting room.
 */
export const getTtrpgRooms = (locale: Locale) =>
  [
    {
      venue: "bar",
      eyebrow: m.ttrpgRoomBarRoomLabel({}, { locale }),
      title: m.ttrpgRoomBarChoiceTitle({}, { locale }),
      seats: m.ttrpgRoomBarCapacity({}, { locale }),
      description: m.ttrpgRoomBarChoiceText({}, { locale }),
      href: getContactHref(
        getDeskohubBarPageUrl({ locale, pathname: "/contact" }),
        m.ttrpgRoomBarPrefillMessage({}, { locale })
      ),
      cta: m.ttrpgRoomBarCta({}, { locale }),
    },
    {
      venue: "workspace",
      eyebrow: m.ttrpgRoomWorkspaceRoomLabel({}, { locale }),
      title: m.ttrpgRoomWorkspaceChoiceTitle({}, { locale }),
      seats: m.ttrpgRoomWorkspaceCapacity({}, { locale }),
      description: m.ttrpgRoomWorkspaceChoiceText({}, { locale }),
      href: getMeetingRoomReservationPath(locale),
      cta: m.ttrpgRoomWorkspaceCta({}, { locale }),
    },
  ] as const;
