import Interpolate from "@doist/react-interpolate";
import { getLocale, m } from "@/features/i18n";
import { Price } from "@/shared/components/price";
import { siteConstants } from "@/shared/utils/constants";
import { formatPricingPolicyDates } from "@/shared/utils/pricing-policy";

/**
 * Renders the player pricing-policy sentence (entrance fee / consumption credit)
 * from the shared `priceInfo` messages, with prices as `Price` components.
 */
export const PriceInfo = ({
  showLegacyPricing,
  className,
}: {
  showLegacyPricing: boolean;
  className?: string;
}) => (
  <Interpolate
    string={
      showLegacyPricing
        ? m["priceInfo.legacyForPlayers"](formatPricingPolicyDates(getLocale()))
        : m["priceInfo.forPlayers"]()
    }
    mapping={{
      entryFee: () => (
        <Price amount={siteConstants.pricing.entryFee} className={className} />
      ),
      consumptionCredit: () => (
        <Price
          amount={siteConstants.pricing.consumptionCredit}
          className={className}
        />
      ),
    }}
  />
);
