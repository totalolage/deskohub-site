import { Effect } from "effect";
import {
  getUnprefixedPagePath,
  getWorkspacePageUrl,
  type Locale,
  m,
} from "@/features/i18n";
import { coworkReservationPath } from "@/features/reservation/routes";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownInterpolate,
  markdownLink,
  markdownParagraph,
} from "@/shared/markdown/markdown";

/**
 * The gallery page's heading and introduction as Markdown. The photos are
 * images only, so they stay out.
 */
export const galleryPageMarkdown = (
  locale: Locale
): Effect.Effect<MarkdownBlocks> =>
  Effect.succeed([
    markdownHeading(1, m.galleryPageTitle({}, { locale })),
    markdownParagraph(
      ...markdownInterpolate(m.galleryPageIntro({}, { locale }), {
        coworking: (content) =>
          markdownLink(
            getWorkspacePageUrl(getUnprefixedPagePath("/[locale]/coworking")),
            ...content
          ),
        reservation: (content) =>
          markdownLink(getWorkspacePageUrl(coworkReservationPath), ...content),
      })
    ),
  ]);
