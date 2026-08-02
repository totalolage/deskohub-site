import Interpolate from "@doist/react-interpolate";
import { m } from "@/features/i18n";
import { OpeningHours } from "@/features/opening-hours";
import { Hero } from "@/shared/components";
import { Price } from "@/shared/components/price";
import { siteConstants } from "@/shared/utils/constants";

export function HomeHero() {
  return (
    <Hero tags="Domovská stránka" fullHeight>
      <div className="max-w-4xl text-white px-6 mx-auto">
        <h1 className="font-bold mb-8 leading-tight">
          <span className="text-6xl md:text-8xl text-green-500">
            {m["hero.title"]()}
          </span>
        </h1>
        <OpeningHours />
        <p className="mt-8 text-md max-w-3xl mx-auto text-gray-200 text-balance">
          {m["hero.description"]()}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-4 text-sm">
          <span className="bg-white/10 backdrop-blur-sm rounded-lg px-4 py-2">
            <Interpolate
              string={m["hero.priceInfo.forPlayers"]()}
              mapping={{
                price: () => (
                  <Price
                    amount={siteConstants.pricing.entryFee}
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
