import { Effect } from "effect";
import { type Locale, m } from "@/features/i18n";
import { type MarkdownBlocks, markdownHeading } from "@/shared/markdown/markdown";

/** TODO(stub): the TTRPG room page's facts as Markdown. */
export const ttrpgRoomPageMarkdown = (locale: Locale): Effect.Effect<MarkdownBlocks> =>
  Effect.succeed([markdownHeading(1, m.ttrpgRoomMetadataTitle({}, { locale }))]);
