import { Effect } from "effect";
import { getWorkspacePageUrl, type Locale, m } from "@/features/i18n";
import { meetingRoomReservationPath } from "@/features/reservation/routes";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownLink,
  markdownList,
  markdownListItem,
  markdownParagraph,
} from "@/shared/markdown/markdown";
import { getMeetingRoomSpecifications } from "./meeting-room-specifications";

/**
 * The meeting room page's facts as Markdown: the hero and the
 * specifications. The gallery is images only, so it stays out.
 */
export const meetingRoomPageMarkdown = (
  locale: Locale
): Effect.Effect<MarkdownBlocks> =>
  Effect.succeed([
    markdownHeading(
      1,
      m.meetingRoomHeroTitle({}, { locale }),
      " ",
      m.meetingRoomHeroTitleAccent({}, { locale })
    ),
    markdownParagraph(m.meetingRoomHeroIntro({}, { locale })),
    markdownList([
      markdownListItem(m.meetingRoomFactCapacity({}, { locale })),
      markdownListItem(m.meetingRoomFactTv({}, { locale })),
      markdownListItem(m.meetingRoomFactPrivacy({}, { locale })),
    ]),
    markdownParagraph(
      markdownLink(
        getWorkspacePageUrl(meetingRoomReservationPath),
        m.meetingRoomReservationCta({}, { locale })
      )
    ),
    markdownHeading(2, m.meetingRoomSpecificationsTitle({}, { locale })),
    markdownParagraph(m.meetingRoomSpecificationsIntro({}, { locale })),
    ...getMeetingRoomSpecifications(locale).flatMap((specification) => [
      markdownHeading(3, specification.title),
      markdownParagraph(specification.text),
    ]),
  ]);
