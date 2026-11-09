import { Effect } from "effect";
import {
  getUnprefixedPagePath,
  getWorkspacePageUrl,
  type Locale,
  m,
} from "@/features/i18n";
import { meetingRoomReservationPath } from "@/features/reservation/routes";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownInterpolate,
  markdownLink,
  markdownList,
  markdownListItem,
  markdownParagraph,
} from "@/shared/markdown/markdown";
import { getMeetingRoomSpecifications } from "./meeting-room-specifications";

/**
 * The meeting room page's facts as Markdown: the hero, the specifications
 * and the closing booking section. The gallery is images only, so it stays
 * out.
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
    markdownHeading(2, m.meetingRoomBookingTitle({}, { locale })),
    markdownParagraph(
      ...markdownInterpolate(m.meetingRoomBookingText({}, { locale }), {
        pricing: (content) =>
          markdownLink(
            getWorkspacePageUrl(getUnprefixedPagePath("/[locale]/pricing")),
            ...content
          ),
      })
    ),
    markdownParagraph(
      ...markdownInterpolate(m.meetingRoomTtrpgNote({}, { locale }), {
        ttrpg: (content) =>
          markdownLink(
            getWorkspacePageUrl(getUnprefixedPagePath("/[locale]/ttrpg-room")),
            ...content
          ),
      })
    ),
    markdownParagraph(
      markdownLink(
        getWorkspacePageUrl(meetingRoomReservationPath),
        m.meetingRoomReservationCta({}, { locale })
      )
    ),
  ]);
