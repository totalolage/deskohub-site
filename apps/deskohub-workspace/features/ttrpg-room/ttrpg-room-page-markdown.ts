import { Effect } from "effect";
import { getWorkspacePageUrl, type Locale, m } from "@/features/i18n";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownLink,
  markdownParagraph,
} from "@/shared/markdown/markdown";
import { getTtrpgRooms } from "./ttrpg-rooms";

/** The TTRPG room page's rooms as Markdown, each room a section. */
export const ttrpgRoomPageMarkdown = (
  locale: Locale
): Effect.Effect<MarkdownBlocks> =>
  Effect.succeed([
    markdownHeading(1, m.ttrpgRoomHeroTitle({}, { locale })),
    ...getTtrpgRooms(locale).flatMap((room) => [
      markdownHeading(2, room.title),
      markdownParagraph(room.eyebrow),
      markdownParagraph(room.seats),
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
  ]);
