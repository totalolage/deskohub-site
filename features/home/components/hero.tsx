import heroImage from "@/assets/images/hero.jpg";
import { m } from "@/i18n";
import { Hero } from "@/shared/components/hero";
import { Price } from "@/shared/components/price";
import { siteConstants } from "@/shared/utils/constants";

export function HomeHero() {
  return (
    <Hero imageSrc={heroImage.src} fullHeight>
      <div className="max-w-4xl text-white px-6 mx-auto">
        <h1 className="font-bold mb-8 leading-tight flex flex-col gap-y-2">
          <span className="text-6xl md:text-8xl text-green-500">
            {m["hero.title"]()}
          </span>
          <br />
          <span className="text-4xl md:text-6xl">{m["hero.subtitle"]()}</span>
        </h1>
        <div className="flex flex-col md:flex-row items-center justify-center space-y-4 md:space-y-0 md:space-x-8 mt-12">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
            <div className="text-sm text-green-400">
              {m["hours.weekdays"]()}
            </div>
            <div className="text-lg font-semibold">
              {siteConstants.workingHours.weekdays.open}-
              {siteConstants.workingHours.weekdays.close}
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
            <div className="text-sm text-green-400">
              {m["hours.weekends"]()}
            </div>
            <div className="text-lg font-semibold">
              {siteConstants.workingHours.weekends.open}-
              {siteConstants.workingHours.weekends.close === "24:00"
                ? "00:00"
                : siteConstants.workingHours.weekends.close}
            </div>
          </div>
        </div>
        <p className="mt-8 text-md max-w-3xl mx-auto text-gray-200">
          {m["hero.description"]()}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-4 text-sm">
          <span className="bg-white/10 backdrop-blur-sm rounded-lg px-4 py-2">
            {m["hero.priceInfo.withPurchase"]()}
            &nbsp;
            <Price
              amount={siteConstants.pricing.entryFee.withPurchase}
              className="text-green-400"
            />
          </span>
          <span className="bg-white/10 backdrop-blur-sm rounded-lg px-4 py-2">
            {m["hero.priceInfo.withoutPurchase"]()}
            &nbsp;
            <Price
              amount={siteConstants.pricing.entryFee.withoutPurchase}
              className="text-green-400"
            />
          </span>
        </div>
      </div>
    </Hero>
  );
}
