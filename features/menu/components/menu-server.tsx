import { NotFound } from "@mcrovero/effect-nextjs/Navigation";
import { Effect } from "effect";
import type { LocalizedPage } from "@/shared/pages/localized";
import { siteConstants } from "@/shared/utils/constants";
import { MenuService } from "../utils/generate-menu-pdf-document";
import { MenuClient } from "./menu-client";
import { MenuHero } from "./menu-hero";

export const MenuPage: LocalizedPage = Effect.fn("MenuPage")(
  function* MenuPage() {
    const menuService = yield* MenuService;
    const props = yield* menuService.getMenuProps();

    return (
      <div className="bg-black">
        <MenuHero />
        <MenuClient
          {...props}
          showPdfDownload={siteConstants.featureFlags.menuPdfDownload}
        />
      </div>
    );
  },
  (effect) =>
    effect.pipe(
      Effect.tapError(
        Effect.fn(function* (error) {
          yield* Effect.logError(error);
        })
      ),
      Effect.annotateLogs({
        page: "MenuPage",
      }),
      Effect.provide(MenuService.Default),
      Effect.orElse(() => NotFound)
    )
);
