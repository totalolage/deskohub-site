import Image from "next/image";
import heroImage from "@/assets/images/hero.jpg";
import { m } from "@/i18n";
import { Price } from "@/shared/components/price";
import { constants } from "@/shared/utils/constants";

export function Hero() {
  return (
    <section className="relative h-[calc(100dvh_-_var(--header-height))] bg-gradient-to-r from-black/70 to-black/50 z-1">
      <Image
        className="mix-blend-overlay brightness-[0.7] object-cover"
        src={heroImage}
        fill
        alt={m["altText.heroImage"]()}
      />
      <div className="relative z-10 flex items-center justify-center h-full text-center text-white px-6">
        <div className="max-w-4xl">
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
                {constants.workingHours.weekdays.open}-
                {constants.workingHours.weekdays.close}
              </div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
              <div className="text-sm text-green-400">
                {m["hours.weekends"]()}
              </div>
              <div className="text-lg font-semibold">
                {constants.workingHours.weekends.open}-
                {constants.workingHours.weekends.close === "24:00"
                  ? "00:00"
                  : constants.workingHours.weekends.close}
              </div>
            </div>
          </div>
          <p className="mt-8 text-md max-w-3xl mx-auto text-gray-200">
            {m["hero.description"]()}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-4 text-sm">
            <span className="bg-white/10 backdrop-blur-sm rounded-lg px-4 py-2">
              {m["hero.priceInfo.withPurchase"]({
                price: (
                  <Price
                    amount={constants.pricing.entryFee.withPurchase}
                    className="text-green-400"
                  />
                ),
              })}
            </span>
            <span className="bg-white/10 backdrop-blur-sm rounded-lg px-4 py-2">
              {m["hero.priceInfo.withoutPurchase"]({
                price: (
                  <Price
                    amount={constants.pricing.entryFee.withoutPurchase}
                    className="text-green-400"
                  />
                ),
              })}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
