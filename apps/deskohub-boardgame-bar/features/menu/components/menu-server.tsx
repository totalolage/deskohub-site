import { Effect } from "effect";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { LocalizedNextComponent } from "@/features/localization/localized-next-component";
import { siteConstants } from "@/shared/utils/constants";
import { isLegacyPricingActive } from "@/shared/utils/pricing-policy";
import { MenuData } from "../data";
import { MenuClient } from "./menu-client";
import { MenuHero } from "./menu-hero";

export const MenuPage: LocalizedNextComponent = Effect.fn("MenuPage")(
  function* MenuPage() {
    yield* Effect.promise(connection);
    const showLegacyPricing = isLegacyPricingActive();
    const { products, categories } = yield* MenuData;

    return (
      <div className="bg-black">
        <MenuHero />
        <MenuClient
          products={products}
          categories={categories}
          showLegacyPricing={showLegacyPricing}
          showPdfDownload={siteConstants.featureFlags.menuPdfDownload}
        />
      </div>
    );
  },
  (effect) =>
    effect.pipe(
      Effect.tapError(Effect.logError),
      Effect.annotateLogs({
        page: "MenuPage",
      }),
      Effect.provide(MenuData.Live),
      Effect.orElseSucceed(notFound)
    )
);
