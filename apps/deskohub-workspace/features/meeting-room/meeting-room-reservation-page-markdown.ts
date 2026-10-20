import type { PublicOffering } from "@/features/checkout/public-offerings";
import { publicOfferingsMarkdown } from "@/features/checkout/public-offerings-markdown";
import { type Locale, m } from "@/features/i18n";
import { reservationPageMarkdown } from "@/features/reservation/reservation-page-markdown";
import { meetingRoomReservationPath } from "@/features/reservation/routes";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownParagraph,
} from "@/shared/markdown/markdown";

/** The meeting-room reservation page's durations and their prices. */
export const meetingRoomReservationPageMarkdown = (
  locale: Locale,
  offerings: ReadonlyArray<PublicOffering>
): MarkdownBlocks => {
  const durations = offerings.filter(
    (offering) => offering.kind === "meeting-room"
  );
  // Every duration books the same room, so its copy is shown once.
  const [room] = durations;

  return reservationPageMarkdown({
    bookingLabel: m.meetingRoomReservationCta({}, { locale }),
    locale,
    pathname: meetingRoomReservationPath,
    products: room
      ? [
          markdownHeading(2, room.name),
          markdownParagraph(room.description),
          publicOfferingsMarkdown(durations, locale),
        ]
      : [],
    summary: m.reservationMeetingRoomMetadataDescription({}, { locale }),
    title: m.reservationMeetingRoomMetadataTitle({}, { locale }),
  });
};
