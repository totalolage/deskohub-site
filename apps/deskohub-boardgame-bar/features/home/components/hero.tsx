import Interpolate from "@doist/react-interpolate";
import { m } from "@/features/i18n";
import { Hero } from "@/shared/components";
import { Price } from "@/shared/components/price";
import { siteConstants } from "@/shared/utils/constants";
import {
  getWeekdayHours,
  getWeekendHours,
} from "@/shared/utils/working-hours-helpers";

export function HomeHero() {
  return (
    <Hero tags="Domovská stránka" fullHeight>
      <div className="max-w-4xl text-white px-6 mx-auto">
        <h1 className="font-bold mb-8 leading-tight">
          <span className="text-6xl md:text-8xl text-green-500">
            {m["hero.title"]()}
          </span>
        </h1>
        <div className="flex flex-col md:flex-row items-center justify-center space-y-4 md:space-y-0 md:space-x-8 mt-12">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
            <div className="text-sm text-green-400">
              {m["hours.weekdays"]()}
            </div>
            <div className="text-lg font-semibold">
              {getWeekdayHours().open}-{getWeekdayHours().close}
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
            <div className="text-sm text-green-400">
              {m["hours.weekends"]()}
            </div>
            <div className="text-lg font-semibold">
              {getWeekendHours().open}-{getWeekendHours().close}
            </div>
          </div>
        </div>
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
