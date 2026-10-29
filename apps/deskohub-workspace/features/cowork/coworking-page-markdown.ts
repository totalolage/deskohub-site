import { getWorkspaceProductTierTitle } from "@/features/checkout/product-catalog.i18n";
import type { PublicOffering } from "@/features/checkout/public-offerings";
import {
  getUnprefixedPagePath,
  getWorkspacePageUrl,
  type Locale,
  m,
  type StaticLocalizedPageRoute,
} from "@/features/i18n";
import { getOfferingSale } from "@/features/pricing/offering-sale";
import { getShareableReservationStartPath } from "@/features/reservation/routes";
import { getShareableSelectionPath } from "@/features/reservation/selection-path";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownInterpolate,
  markdownLink,
  markdownList,
  markdownListItem,
  markdownOrderedList,
  markdownParagraph,
} from "@/shared/markdown/markdown";
import { formatMoney } from "@/shared/money/money";
import {
  getCoworkingAmenities,
  getCoworkingDesks,
  getCoworkingSteps,
} from "./coworking-page-content";

const pageUrl = (route: StaticLocalizedPageRoute) =>
  getWorkspacePageUrl(getUnprefixedPagePath(route));

/**
 * The coworking page's facts as Markdown, in page order: the hero, both
 * desks with their prices, the amenities, the steps and the closing booking
 * section. The breadcrumbs and photos stay out.
 */
export const coworkingPageMarkdown = (
  locale: Locale,
  offerings: ReadonlyArray<PublicOffering>
): MarkdownBlocks => {
  const reservationUrl = getWorkspacePageUrl(
    getShareableReservationStartPath("cowork")
  );
  const reservationLink = markdownParagraph(
    markdownLink(reservationUrl, m.coworkReservationLink({}, { locale }))
  );

  return [
    markdownHeading(1, m.coworkingHeroTitle({}, { locale })),
    markdownParagraph(m.coworkingHeroIntro({}, { locale })),
    markdownList([
      markdownListItem(m.coworkingFactMetro({}, { locale })),
      markdownListItem(m.coworkingFactAlwaysOpen({}, { locale })),
      markdownListItem(m.coworkingFactPin({}, { locale })),
    ]),
    reservationLink,
    markdownHeading(2, m.coworkingDesksTitle({}, { locale })),
    markdownParagraph(m.coworkingDesksIntro({}, { locale })),
    ...getCoworkingDesks(locale).flatMap((desk) => {
      const offering = offerings.find(
        (candidate) =>
          candidate.kind === "cowork" && candidate.tier === desk.tier
      );
      const sale = offering && getOfferingSale(offering, locale);

      return [
        markdownHeading(3, getWorkspaceProductTierTitle(desk.tier, locale)),
        ...(offering
          ? [
              markdownParagraph(
                m.pricingPerDay(
                  { price: formatMoney(offering.price, locale) },
                  { locale }
                )
              ),
            ]
          : []),
        ...(sale
          ? [markdownParagraph(m.pricingSalePrice(sale, { locale }))]
          : []),
        markdownParagraph(desk.text),
        markdownList(desk.points.map((point) => markdownListItem(point))),
        markdownParagraph(
          markdownLink(
            getWorkspacePageUrl(
              getShareableSelectionPath({
                kind: "cowork",
                entryTier: desk.tier,
              })
            ),
            desk.cta
          )
        ),
      ];
    }),
    markdownParagraph(
      ...markdownInterpolate(m.coworkingPricesNote({}, { locale }), {
        pricing: (content) =>
          markdownLink(pageUrl("/[locale]/pricing"), ...content),
      })
    ),
    markdownHeading(2, m.coworkingAmenitiesTitle({}, { locale })),
    ...getCoworkingAmenities(locale).flatMap((amenity) => [
      markdownHeading(3, amenity.title),
      markdownParagraph(
        ...markdownInterpolate(amenity.text, {
          meetingRoom: (content) =>
            markdownLink(
              getWorkspacePageUrl(
                getShareableReservationStartPath("meeting-room")
              ),
              ...content
            ),
        })
      ),
    ]),
    markdownHeading(2, m.coworkingStepsTitle({}, { locale })),
    markdownOrderedList(
      getCoworkingSteps(locale).map((step) => markdownListItem(step))
    ),
    markdownHeading(2, m.coworkingBookingTitle({}, { locale })),
    markdownParagraph(
      ...markdownInterpolate(m.coworkingBookingText({}, { locale }), {
        faq: (content) => markdownLink(pageUrl("/[locale]/faq"), ...content),
        contact: (content) =>
          markdownLink(pageUrl("/[locale]/contact"), ...content),
      })
    ),
    reservationLink,
  ];
};
