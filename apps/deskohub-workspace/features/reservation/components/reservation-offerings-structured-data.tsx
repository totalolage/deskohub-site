import type { PublicCatalogOffering } from "@/features/checkout/public-offerings";
import { getPublicOfferingsStructuredData } from "@/features/checkout/public-offerings-structured-data";
import { getWorkspacePageUrl, type Locale } from "@/features/i18n";
import { StructuredData } from "@/shared/components/structured-data";

/** The Schema.org services and offers a reservation page books. */
export function ReservationOfferingsStructuredData({
  locale,
  offerings,
  pathname,
}: {
  readonly locale: Locale;
  readonly offerings: ReadonlyArray<PublicCatalogOffering>;
  readonly pathname: string;
}) {
  return (
    <StructuredData
      data={getPublicOfferingsStructuredData({
        locale,
        offerings,
        url: getWorkspacePageUrl(pathname),
      })}
    />
  );
}
