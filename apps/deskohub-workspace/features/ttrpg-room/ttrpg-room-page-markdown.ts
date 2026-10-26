import { Effect } from "effect";
import {
  getUnprefixedPagePath,
  getWorkspacePageUrl,
  type Locale,
  m,
} from "@/features/i18n";
import type { PublicPageMarkdownSources } from "@/features/public-pages/public-page-markdown";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownInterpolate,
  markdownLink,
  markdownParagraph,
} from "@/shared/markdown/markdown";
import { getTtrpgRooms } from "./ttrpg-rooms";

/**
 * The TTRPG room page as Markdown: the lead, each room a section, then the
 * notes on longer sessions and on choosing a room.
 */
export const ttrpgRoomPageMarkdown = (
  locale: Locale,
  { isPublished }: Pick<PublicPageMarkdownSources, "isPublished">
): Effect.Effect<MarkdownBlocks> =>
  Effect.succeed([
    markdownHeading(1, m.ttrpgRoomHeroTitle({}, { locale })),
    markdownParagraph(m.ttrpgRoomHeroLead({}, { locale })),
    ...getTtrpgRooms(locale).flatMap((room) => [
      markdownHeading(2, room.title),
      markdownParagraph(room.eyebrow),
      markdownParagraph(room.seats),
      markdownParagraph(room.description),
      // A Workspace room links by path, a Bar room by its full URL.
      markdownParagraph(
        markdownLink(
          room.href.startsWith("/")
            ? getWorkspacePageUrl(room.href)
            : room.href,
          room.cta
        )
      ),
    ]),
    markdownHeading(2, m.ttrpgRoomGalleryTitle({}, { locale })),
    markdownParagraph(m.ttrpgRoomGalleryText({}, { locale })),
    markdownParagraph(
      m.ttrpgRoomBookingNote({}, { locale }),
      " ",
      markdownLink(
        getWorkspacePageUrl(getUnprefixedPagePath("/[locale]/contact")),
        m.ttrpgRoomBookingNoteLink({}, { locale })
      )
    ),
    ...(isPublished("/meeting-room")
      ? [
          markdownParagraph(
            ...markdownInterpolate(m.ttrpgRoomMeetingRoomNote({}, { locale }), {
              meetingRoom: (content) =>
                markdownLink(
                  getWorkspacePageUrl(
                    getUnprefixedPagePath("/[locale]/meeting-room")
                  ),
                  ...content
                ),
            })
          ),
        ]
      : []),
  ]);
