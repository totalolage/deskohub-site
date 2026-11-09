import type { PublicOffering } from "@/features/checkout/public-offerings";
import { publicOfferingsMarkdown } from "@/features/checkout/public-offerings-markdown";
import { type Locale, m } from "@/features/i18n";
import { reservationPageMarkdown } from "@/features/reservation/reservation-page-markdown";
import { officeReservationPath } from "@/features/reservation/routes";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownParagraph,
} from "@/shared/markdown/markdown";

/**
 * The office reservation page's day and seat prices. Offerings omit the
 * office while office reservations are closed.
 */
export const officeReservationPageMarkdown = (
  locale: Locale,
  offerings: ReadonlyArray<PublicOffering>
): MarkdownBlocks =>
  reservationPageMarkdown({
    bookingLabel: m.reservationOfficeFormTitle({}, { locale }),
    locale,
    pathname: officeReservationPath,
    products: offerings
      .filter((offering) => offering.kind === "office")
      .flatMap((office) => [
        markdownHeading(2, office.name),
        markdownParagraph(office.description),
        publicOfferingsMarkdown([office], locale),
      ]),
  });
