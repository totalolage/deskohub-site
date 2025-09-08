import { getLocale, m } from "@/features/i18n";
import { siteConstants } from "@/shared/utils/constants";
import { formatPrice } from "@/shared/utils/price-formatting";

export function MenuFooterNote() {
  const locale = getLocale();

  return (
    <div className="text-center mt-16 p-6 bg-black/40 backdrop-blur-sm rounded-lg border border-green-400/20">
      <p className="text-gray-300">
        {m["menu.footerNote"]({
          priceWith: formatPrice(
            siteConstants.pricing.entryFee.withPurchase,
            locale
          ),
          priceWithout: formatPrice(
            siteConstants.pricing.entryFee.withoutPurchase,
            locale
          ),
        })}
      </p>
    </div>
  );
}
