import { Effect } from "effect";
import { notFound } from "next/navigation";
import type { LocalizedNextComponent } from "@/features/localization/localized-next-component";
import { siteConstants } from "@/shared/utils/constants";
import { MenuData } from "../data";
import { MenuClient } from "./menu-client";
import { MenuHero } from "./menu-hero";

export const MenuPage: LocalizedNextComponent = Effect.fn("MenuPage")(
  function* MenuPage() {
    const { products, categories } = yield* MenuData;

    return (
      <div className="bg-black">
        <MenuHero />
        <MenuClient
          products={products}
          categories={categories}
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
      Effect.provide(MenuData.Default),
      Effect.orElseSucceed(notFound)
    )
);
