import Interpolate from "@doist/react-interpolate";
import { getLocale, m } from "@/features/i18n";
import { OpeningHours } from "@/features/opening-hours";
import { Hero } from "@/shared/components";
import { Price } from "@/shared/components/price";
import { siteConstants } from "@/shared/utils/constants";
import { formatPricingPolicyDates } from "@/shared/utils/pricing-policy";

export function HomeHero({
  showLegacyPricing,
}: {
  showLegacyPricing: boolean;
}) {
  return (
    <Hero
      tags="Domovská stránka"
      fullHeight
      className="bg-gray-900 before:absolute before:inset-0 before:z-[5] before:bg-black/75"
    >
      <div className="max-w-4xl text-white px-6 mx-auto">
        <h1 className="font-bold mb-8 leading-tight">
          <span className="text-5xl sm:text-6xl md:text-8xl text-green-500">
            {m["hero.title"]()}
          </span>
        </h1>
        <OpeningHours />
        <p className="mt-8 text-md max-w-3xl mx-auto text-gray-200 text-balance">
          {m["hero.description"]()}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-4 text-sm">
          <span className="bg-black/60 backdrop-blur-sm rounded-lg px-4 py-2">
            <Interpolate
              string={
                showLegacyPricing
                  ? m["hero.priceInfo.legacyForPlayers"](
                      formatPricingPolicyDates(getLocale())
                    )
                  : m["hero.priceInfo.forPlayers"]()
              }
              mapping={{
                entryFee: () => (
                  <Price
                    amount={siteConstants.pricing.entryFee}
                    className="text-green-400"
                  />
                ),
                consumptionCredit: () => (
                  <Price
                    amount={siteConstants.pricing.consumptionCredit}
                    className="text-green-400"
                  />
                ),
              }}
            />
          </span>
        </div>
      </div>
    </Hero>
  );
}
