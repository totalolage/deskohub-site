import type { PublicPriceListOffering } from "@/features/checkout/public-offerings";
import { getPublicOfferingsStructuredData } from "@/features/checkout/public-offerings-structured-data";
import type { Locale } from "@/features/i18n";
import { StructuredData } from "@/shared/components/structured-data";

/** The Schema.org services and offers of the products a page shows. */
export function PublicOfferingsStructuredData({
  locale,
  offerings,
}: {
  readonly locale: Locale;
  readonly offerings: ReadonlyArray<PublicPriceListOffering>;
}) {
  return (
    <StructuredData
      data={getPublicOfferingsStructuredData({ locale, offerings })}
    />
  );
}
