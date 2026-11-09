import { Effect } from "effect";
import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { getFaqQuestions } from "@/features/faq";
import {
  getUnprefixedPagePath,
  getWorkspacePageUrl,
  type Locale,
  m,
} from "@/features/i18n";
import type { PublicPageMarkdownSources } from "@/features/public-pages/public-page-markdown";
import {
  coworkReservationPath,
  meetingRoomReservationPath,
} from "@/features/reservation/routes";
import {
  type MarkdownBlocks,
  markdownBlockquote,
  markdownHeading,
  markdownInterpolate,
  markdownLink,
  markdownList,
  markdownListItem,
  markdownOrderedList,
  markdownParagraph,
  markdownStrong,
} from "@/shared/markdown/markdown";
import {
  getDeskohubBarPageUrl,
  workspaceSiteConstants,
} from "@/shared/utils/site-constants";
import {
  workspaceFormattedAddress,
  workspaceGoogleDirectionsUrl,
} from "@/shared/utils/workspace-location-map";
import type { LandingPageSaleBannerContent } from "./components/landing-page-sale-banner";
import { getLandingPageAmenities } from "./landing-page-amenities";

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
 * sale runs, the location with access, the offering, the amenities, the FAQ
 * questions and the contact band. The photo carousel is images only. The
 * note that private offices are not offered yet shows while office booking
 * is unpublished, as on the HTML page.
 */
export const landingPageMarkdown = (
  locale: Locale,
  { isPublished, saleBanner }: PublicPageMarkdownSources
): Effect.Effect<MarkdownBlocks> => {
  const contactUrl = getWorkspacePageUrl(
    getUnprefixedPagePath("/[locale]/contact")
  );
  const infoEmail = workspaceSiteConstants.contact.infoEmail;
  const coworkReservationUrl = getWorkspacePageUrl(coworkReservationPath);
  const meetingRoomReservationUrl = getWorkspacePageUrl(
    meetingRoomReservationPath
  );
  const titledParagraph = (title: string, text: string) =>
    markdownParagraph(markdownStrong(`${title}:`), " ", text);

  return Effect.map(saleBanner, (banner) => [
    markdownHeading(1, m.landingHeroTitle({}, { locale })),
    ...(banner ? [saleBannerMarkdown(banner)] : []),
    markdownParagraph(m.landingHeroSubtitle({}, { locale })),
    markdownList([
      ...(isPublished("/meeting-room")
        ? [
            markdownListItem(
              markdownLink(
                getWorkspacePageUrl(
                  getUnprefixedPagePath("/[locale]/meeting-room")
                ),
                m.landingHeroMeetingRoomCta({}, { locale })
              )
            ),
          ]
        : []),
      markdownListItem(
        markdownLink(
          coworkReservationUrl,
          m.landingHeroPrimaryCta({}, { locale })
        )
      ),
      markdownListItem(
        markdownLink(contactUrl, m.landingHeroSecondaryCta({}, { locale }))
      ),
    ]),
    markdownHeading(2, m.landingLocationMapTitle({}, { locale })),
    markdownParagraph(workspaceFormattedAddress),
    markdownParagraph(m.landingLocationTransport({}, { locale })),
    markdownHeading(3, m.landingAccessTitle({}, { locale })),
    markdownOrderedList([
      markdownListItem(m.landingAccessStepBook({}, { locale })),
      markdownListItem(m.landingAccessStepEmail({}, { locale })),
      markdownListItem(m.landingAccessStepKeypad({}, { locale })),
      markdownListItem(m.landingAccessStepStay({}, { locale })),
    ]),
    markdownParagraph(
      markdownLink(
        workspaceGoogleDirectionsUrl,
        m.landingLocationMapCta({}, { locale })
      )
    ),
    markdownHeading(2, m.landingOfferingTitle({}, { locale })),
    markdownParagraph(
      ...markdownInterpolate(m.landingOfferingLead({}, { locale }), {
        pricing: (content) =>
          markdownLink(
            getWorkspacePageUrl(getUnprefixedPagePath("/[locale]/pricing")),
            ...content
          ),
      })
    ),
    markdownHeading(3, m.landingOfferingCoworkTitle({}, { locale })),
    titledParagraph(
      getWorkspaceProductTierTitle("open-space", locale),
      m.landingOfferingOpenSpaceText({}, { locale })
    ),
    titledParagraph(
      getWorkspaceProductTierTitle("reserved-desk", locale),
      m.landingOfferingReservedDeskText({}, { locale })
    ),
    markdownList([
      markdownListItem(
        markdownLink(
          coworkReservationUrl,
          m.coworkReservationLink({}, { locale })
        )
      ),
      markdownListItem(
        markdownLink(
          getWorkspacePageUrl(getUnprefixedPagePath("/[locale]/coworking")),
          m.landingOfferingCoworkPageLink({}, { locale })
        )
      ),
    ]),
    markdownHeading(3, getWorkspaceMeetingRoomProductTitle(locale)),
    markdownParagraph(m.landingOfferingMeetingRoomText({}, { locale })),
    markdownList([
      markdownListItem(
        markdownLink(
          meetingRoomReservationUrl,
          m.meetingRoomReservationLink({}, { locale })
        )
      ),
      ...(isPublished("/meeting-room")
        ? [
            markdownListItem(
              markdownLink(
                getWorkspacePageUrl(
                  getUnprefixedPagePath("/[locale]/meeting-room")
                ),
                m.landingOfferingMeetingRoomPageLink({}, { locale })
              )
            ),
          ]
        : []),
    ]),
    markdownHeading(3, m.landingOfferingTtrpgTitle({}, { locale })),
    markdownParagraph(m.landingOfferingTtrpgText({}, { locale })),
    markdownParagraph(
      markdownLink(
        getWorkspacePageUrl(getUnprefixedPagePath("/[locale]/ttrpg-room")),
        m.landingOfferingTtrpgLink({}, { locale })
      )
    ),
    markdownParagraph(
      ...markdownInterpolate(m.landingOfferingEvents({}, { locale }), {
        contact: (content) => markdownLink(contactUrl, ...content),
      }),
      ...(isPublished("/reservation/office")
        ? []
        : [" ", m.landingOfferingOffices({}, { locale })])
    ),
    markdownHeading(2, m.landingAmenitiesTitle({}, { locale })),
    markdownList(
      getLandingPageAmenities(locale).map(({ id, title, text }) =>
        markdownListItem(
          markdownStrong(`${title}:`),
          " ",
          text,
          ...(id === "bar"
            ? [
                " ",
                markdownLink(
                  getDeskohubBarPageUrl(),
                  m.landingFooterBarCta({}, { locale })
                ),
              ]
            : [])
        )
      )
    ),
    markdownHeading(2, m.landingFaqTeaserTitle({}, { locale })),
    markdownList(
      getFaqQuestions(locale).map((question) => markdownListItem(question))
    ),
    markdownParagraph(
      markdownLink(
        getWorkspacePageUrl(getUnprefixedPagePath("/[locale]/faq")),
        m.landingFaqTeaserLink({}, { locale })
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
          getDeskohubBarPageUrl(),
          m.landingFooterBarCta({}, { locale })
        )
      ),
    ]),
  ]);
};
