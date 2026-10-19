import { Effect } from "effect";
import { getLocalizedPagePath, type Locale, m } from "@/features/i18n";
import type { PublicPageMarkdownSources } from "@/features/public-pages/public-page-markdown";
import { getCoworkReservationPath } from "@/features/reservation/routes";
import { siteHeaderSectionIds } from "@/shared/components/site-header-config";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownLink,
  markdownList,
  markdownListItem,
  markdownParagraph,
} from "@/shared/markdown/markdown";
import {
  getWorkspaceCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils/site-constants";
import {
  workspaceFormattedAddress,
  workspaceGoogleDirectionsUrl,
} from "@/shared/utils/workspace-location-map";

/**
 * The home page's facts as Markdown: the hero, the location and the contact
 * band. The sale banner stays out: it reads the `calendar_sales` flag per
 * request, and current sale prices reach agents through the reservation
 * pages and `llms.txt`. The photo carousel is images only.
 */
export const landingPageMarkdown = (
  locale: Locale,
  { isPublished }: PublicPageMarkdownSources
): Effect.Effect<MarkdownBlocks> => {
  const contactUrl = getWorkspaceCanonicalUrl(
    getLocalizedPagePath(locale, "/[locale]/contact")
  );
  const infoEmail = workspaceSiteConstants.contact.infoEmail;

  return Effect.succeed([
    markdownHeading(1, m.landingHeroTitle({}, { locale })),
    markdownParagraph(m.landingHeroSubtitle({}, { locale })),
    markdownList([
      ...(isPublished("/meeting-room")
        ? [
            markdownListItem(
              markdownLink(
                getWorkspaceCanonicalUrl(
                  getLocalizedPagePath(locale, "/[locale]/meeting-room")
                ),
                m.landingHeroMeetingRoomCta({}, { locale })
              )
            ),
          ]
        : []),
      markdownListItem(
        markdownLink(
          getWorkspaceCanonicalUrl(getCoworkReservationPath(locale)),
          m.landingHeroPrimaryCta({}, { locale })
        )
      ),
      markdownListItem(
        markdownLink(contactUrl, m.landingHeroSecondaryCta({}, { locale }))
      ),
    ]),
    markdownHeading(2, m.landingLocationMapTitle({}, { locale })),
    markdownParagraph(workspaceFormattedAddress),
    markdownParagraph(
      markdownLink(
        workspaceGoogleDirectionsUrl,
        m.landingLocationMapCta({}, { locale })
      )
    ),
    markdownHeading(2, m.landingFooterContactTitle({}, { locale })),
    markdownParagraph(m.landingFooterContactLead({}, { locale })),
    markdownParagraph(markdownLink(`mailto:${infoEmail}`, infoEmail)),
    markdownList([
      markdownListItem(
        markdownLink(contactUrl, m.landingFooterContactCta({}, { locale }))
      ),
      markdownListItem(
        markdownLink(
          getWorkspaceCanonicalUrl(
            `/${locale}#${siteHeaderSectionIds.overview}`
          ),
          m.landingFooterBarCta({}, { locale })
        )
      ),
    ]),
  ]);
};
