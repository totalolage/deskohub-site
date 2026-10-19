import { type Locale, m } from "@/features/i18n";
import { getMeetingRoomReservationPath } from "@/features/reservation/routes";

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
      href: getContactHref(
        `https://bar.deskohub.cz/${locale}/contact`,
        m.ttrpgRoomBarPrefillMessage({}, { locale })
      ),
      cta: m.ttrpgRoomBarCta({}, { locale }),
    },
    {
      venue: "workspace",
      eyebrow: m.ttrpgRoomWorkspaceRoomLabel({}, { locale }),
      title: m.ttrpgRoomWorkspaceChoiceTitle({}, { locale }),
      seats: m.ttrpgRoomWorkspaceCapacity({}, { locale }),
      href: getMeetingRoomReservationPath(locale),
      cta: m.ttrpgRoomWorkspaceCta({}, { locale }),
    },
  ] as const;
