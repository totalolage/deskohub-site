import { Effect } from "effect";
import { type Locale, m } from "@/features/i18n";
import { type MarkdownBlocks, markdownHeading } from "@/shared/markdown/markdown";

/** TODO(stub): the home page's facts as Markdown. */
export const landingPageMarkdown = (locale: Locale): Effect.Effect<MarkdownBlocks> =>
  Effect.succeed([markdownHeading(1, m.landingMetadataTitle({}, { locale }))]);
