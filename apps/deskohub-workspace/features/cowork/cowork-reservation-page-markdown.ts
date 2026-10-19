import { workspaceProductTierCardMessages } from "@/features/checkout/product-catalog.i18n";
import type { PublicOffering } from "@/features/checkout/public-offerings";
import { publicOfferingsMarkdown } from "@/features/checkout/public-offerings-markdown";
import { type Locale, m } from "@/features/i18n";
import { reservationPageMarkdown } from "@/features/reservation/reservation-page-markdown";
import { coworkReservationPath } from "@/features/reservation/routes";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownList,
  markdownListItem,
  markdownParagraph,
} from "@/shared/markdown/markdown";

/** The cowork reservation page's offers, as its tier cards show them. */
export const coworkReservationPageMarkdown = (
  locale: Locale,
  offerings: ReadonlyArray<PublicOffering>
): MarkdownBlocks =>
  reservationPageMarkdown({
    bookingLabel: m.landingHeroPrimaryCta({}, { locale }),
    locale,
    pathname: coworkReservationPath,
    products: offerings
      .filter((offering) => offering.kind === "cowork")
      .flatMap((offering) => {
        const card = workspaceProductTierCardMessages[offering.tier];
        return [
          markdownHeading(2, offering.name),
          publicOfferingsMarkdown([offering], locale),
          markdownParagraph(offering.description),
          markdownParagraph(card.description({}, { locale })),
          markdownParagraph(card.perksLabel({}, { locale })),
          markdownList(
            card.perks.map(({ message }) =>
              markdownListItem(message({}, { locale }))
            )
          ),
        ];
      }),
    summary: m.checkoutOrderMetadataDescription({}, { locale }),
    title: m.checkoutOrderMetadataTitle({}, { locale }),
  });
