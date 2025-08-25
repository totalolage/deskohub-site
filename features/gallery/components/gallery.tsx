"use client";

import { CldImage } from "next-cloudinary";
import { use } from "react";
import { m } from "@/i18n";
import { Price } from "@/shared/components/price";
import { siteConstants } from "@/shared/utils/constants";
import type { CloudinaryAsset } from "../backend/cloudinary.service";

export function Gallery({
  imagesPromise,
}: {
  imagesPromise: Promise<readonly CloudinaryAsset[]>;
}) {
  const images = use(imagesPromise);

  return (
    <section className="py-16 bg-amber-50">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          {images.map((image) => (
            <div
              key={image.public_id}
              className="rounded-full overflow-hidden aspect-square"
            >
              <CldImage
                src={image.public_id}
                alt={image.context?.custom?.alt || image.public_id}
                width={600}
                height={600}
                crop="fill"
                gravity="auto"
                className="w-full h-full object-cover"
                priority
              />
            </div>
          ))}
        </div>

        <div className="text-center max-w-4xl mx-auto">
          <p className="text-lg text-gray-700 leading-relaxed">
            {m["about.description"]()}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-4">
            <div className="bg-white rounded-lg shadow-sm px-6 py-3">
              <span className="text-gray-700">
                {m["about.priceInfo.withPurchase"]()}
                &nbsp;
                <Price
                  amount={siteConstants.pricing.entryFee.withPurchase}
                  className="text-green-600 font-bold"
                />
              </span>
            </div>
            <div className="bg-white rounded-lg shadow-sm px-6 py-3">
              <span className="text-gray-700">
                {m["about.priceInfo.withoutPurchase"]()}
                &nbsp;
                <Price
                  amount={siteConstants.pricing.entryFee.withoutPurchase}
                  className="text-green-600 font-bold"
                />
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
