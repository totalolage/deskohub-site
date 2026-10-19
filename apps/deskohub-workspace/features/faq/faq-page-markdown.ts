import { Effect } from "effect";
import { type Locale, m } from "@/features/i18n";
import { type MarkdownBlocks, markdownHeading } from "@/shared/markdown/markdown";

/** TODO(stub): the FAQ page's facts as Markdown. */
export const faqPageMarkdown = (locale: Locale): Effect.Effect<MarkdownBlocks> =>
  Effect.succeed([markdownHeading(1, m.faqMetadataTitle({}, { locale }))]);
