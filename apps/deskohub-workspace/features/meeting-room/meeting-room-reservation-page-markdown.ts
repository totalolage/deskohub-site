import type { PublicOffering } from "@/features/checkout/public-offerings";
import { type Locale, m } from "@/features/i18n";
import { type MarkdownBlocks, markdownHeading } from "@/shared/markdown/markdown";

/** TODO(stub): the meeting-room reservation page's facts as Markdown. */
export const meetingRoomReservationPageMarkdown = (
  locale: Locale,
  _offerings: ReadonlyArray<PublicOffering>
): MarkdownBlocks => [markdownHeading(1, m.reservationMeetingRoomMetadataTitle({}, { locale }))];
