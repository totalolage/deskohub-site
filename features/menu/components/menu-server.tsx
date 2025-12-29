import { NotFound } from "@mcrovero/effect-nextjs/Navigation";
import { Effect } from "effect";
import { DotyposService } from "@/features/dotypos";
import type { LocalizedPage } from "@/shared/pages/localized";
import { siteConstants } from "@/shared/utils/constants";
import { MenuClient } from "./menu-client";
import { MenuHero } from "./menu-hero";

export const MenuPage: LocalizedPage = Effect.fn("MenuPage")(
  function* MenuPage() {
    const dotypos = yield* Effect.provide(
      DotyposService,
      DotyposService.Default
    );
    const menuItems = yield* dotypos
      .getMenuItems()
      .pipe(Effect.orElseSucceed(() => null));

    if (!menuItems) return yield* NotFound;

    const { products, categories } = menuItems;

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
  }
);
