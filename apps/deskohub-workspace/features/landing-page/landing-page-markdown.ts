import { Effect } from "effect";
import {
  getPagePath,
  getWorkspacePageUrl,
  type Locale,
  m,
} from "@/features/i18n";
import type { PublicPageMarkdownSources } from "@/features/public-pages/public-page-markdown";
import { coworkReservationPath } from "@/features/reservation/routes";
import { siteHeaderSectionIds } from "@/shared/components/site-header-config";
import {
  type MarkdownBlocks,
  markdownBlockquote,
  markdownHeading,
  markdownInterpolate,
  markdownLink,
  markdownList,
  markdownListItem,
  markdownParagraph,
  markdownStrong,
} from "@/shared/markdown/markdown";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  workspaceFormattedAddress,
  workspaceGoogleDirectionsUrl,
} from "@/shared/utils/workspace-location-map";
import type { LandingPageSaleBannerContent } from "./components/landing-page-sale-banner";

/** The sale banner, an aside like its HTML: the sale and its booking link. */
const saleBannerMarkdown = (banner: LandingPageSaleBannerContent) =>
  markdownBlockquote(
    markdownParagraph(markdownStrong(banner.statusLabel)),
    markdownParagraph(
      ...markdownInterpolate(banner.label.template, {
        title: banner.label.title,
        adjustment: banner.label.adjustment,
        discount: (content) => markdownStrong(...content),
      })
    ),
    markdownParagraph(
      markdownLink(getWorkspacePageUrl(banner.href), banner.ctaLabel)
    )
  );

/**
 * The home page's facts as Markdown: the hero with the sale banner while a
 * sale runs, the location and the contact band. The photo carousel is images
 * only.
 */
export const landingPageMarkdown = (
  locale: Locale,
  { isPublished, saleBanner }: PublicPageMarkdownSources
): Effect.Effect<MarkdownBlocks> => {
  const contactUrl = getWorkspacePageUrl(getPagePath("/[locale]/contact"));
  const infoEmail = workspaceSiteConstants.contact.infoEmail;

  return Effect.map(saleBanner, (banner) => [
    markdownHeading(1, m.landingHeroTitle({}, { locale })),
    ...(banner ? [saleBannerMarkdown(banner)] : []),
    markdownParagraph(m.landingHeroSubtitle({}, { locale })),
    markdownList([
      ...(isPublished("/meeting-room")
        ? [
            markdownListItem(
              markdownLink(
                getWorkspacePageUrl(getPagePath("/[locale]/meeting-room")),
                m.landingHeroMeetingRoomCta({}, { locale })
              )
            ),
          ]
        : []),
      markdownListItem(
        markdownLink(
          getWorkspacePageUrl(coworkReservationPath),
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
          getWorkspacePageUrl(`/#${siteHeaderSectionIds.overview}`),
          m.landingFooterBarCta({}, { locale })
        )
      ),
    ]),
  ]);
};
