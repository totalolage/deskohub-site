import Image from "next/image";
import placeholderImage from "@/assets/images/placeholder/placeholder.svg";
import { m } from "@/i18n";
import { Price } from "@/shared/components/price";
import { constants } from "@/shared/utils/constants";

export function Gallery() {
  return (
    <section className="py-16 bg-amber-50">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          <div className="rounded-full overflow-hidden aspect-square">
            <Image
              src={placeholderImage}
              alt={m["altText.boardGames"]()}
              width={300}
              height={300}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="rounded-full overflow-hidden aspect-square">
            <Image
              src={placeholderImage}
              alt={m["altText.gamingArea"]()}
              width={300}
              height={300}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="rounded-full overflow-hidden aspect-square">
            <Image
              src={placeholderImage}
              alt={m["altText.barAtmosphere"]()}
              width={300}
              height={300}
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        <div className="text-center max-w-4xl mx-auto">
          <p className="text-lg text-gray-700 leading-relaxed">
            {m["about.description"]()}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-4">
            <div className="bg-white rounded-lg shadow-sm px-6 py-3">
              <span className="text-gray-700">
                {m["about.priceInfo.withPurchase"]({
                  price: (
                    <Price
                      amount={constants.pricing.entryFee.withPurchase}
                      className="text-green-600 font-bold"
                    />
                  ),
                })}
              </span>
            </div>
            <div className="bg-white rounded-lg shadow-sm px-6 py-3">
              <span className="text-gray-700">
                {m["about.priceInfo.withoutPurchase"]({
                  price: (
                    <Price
                      amount={constants.pricing.entryFee.withoutPurchase}
                      className="text-green-600 font-bold"
                    />
                  ),
                })}
              </span>
            </div>
            <div className="bg-green-100 rounded-lg shadow-sm px-6 py-3">
              <span className="text-green-800 font-medium">
                {m["about.priceInfo.childrenFree"]()}
              </span>
            </div>
            <div className="bg-green-100 rounded-lg shadow-sm px-6 py-3">
              <span className="text-green-800 font-medium">
                {m["about.priceInfo.mondayFree"]()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
