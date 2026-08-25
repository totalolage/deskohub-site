import { getLocale, m } from "@/features/i18n";
import { siteConstants } from "@/shared/utils/constants";
import { formatPrice } from "@/shared/utils/price-formatting";

export function MenuFooterNote({
  showLegacyPricing,
}: {
  showLegacyPricing: boolean;
}) {
  const locale = getLocale();

  return (
    <div className="text-center mt-16 p-6 bg-black/40 backdrop-blur-sm rounded-lg border border-green-400/20">
      <p className="text-gray-300">
        {m[showLegacyPricing ? "menu.legacyFooterNote" : "menu.footerNote"]({
          consumptionCredit: formatPrice(
            siteConstants.pricing.consumptionCredit,
            locale
          ),
          entryFee: formatPrice(siteConstants.pricing.entryFee, locale),
        })}
      </p>
    </div>
  );
}
