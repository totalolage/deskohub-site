import Interpolate from "@doist/react-interpolate";
import { getLocale, m } from "@/features/i18n";
import { LocalizedLink } from "@/features/i18n/components/localized-link";
import { Price } from "@/shared/components/price";
import { siteConstants } from "@/shared/utils/constants";
import {
  formatEntranceFeeTiersStartDate,
  getEntranceFeeTiersPhase,
} from "@/shared/utils/pricing-policy";

/**
 * Renders the player pricing-policy sentence from the shared `priceInfo`
 * messages, with prices as `Price` components. It follows the entrance-fee
 * tiers phase: current entry-fee pricing, an announcement of the upcoming
 * tiers a month before they take effect, and finally the tiers-only quote.
 */
export const PriceInfo = ({ className }: { className?: string }) => {
  const locale = getLocale();
  const phase = getEntranceFeeTiersPhase();
  const maxTierFee = Math.max(
    ...siteConstants.pricing.entranceFeeTiers.map((tier) => tier.fee)
  );
  const quoteByPhase = {
    current: m["priceInfo.forPlayers"](),
    announced: m["priceInfo.upcomingTiersForPlayers"]({
      tiersStartDate: formatEntranceFeeTiersStartDate(locale),
    }),
    active: m["priceInfo.tiersForPlayers"](),
  };

  return (
    <Interpolate
      string={quoteByPhase[phase]}
      mapping={{
        entryFee: () => (
          <Price
            amount={siteConstants.pricing.entryFee}
            className={className}
          />
        ),
        entryFeeWithoutOrder: () => (
          <Price
            amount={siteConstants.pricing.entryFeeWithoutOrder}
            className={className}
          />
        ),
        maxTierFee: () => <Price amount={maxTierFee} className={className} />,
        tiersLink: (text) => (
          <LocalizedLink
            href="/entrance-fees"
            className="underline hover:no-underline"
          >
            {text}
          </LocalizedLink>
        ),
      }}
    />
  );
};
