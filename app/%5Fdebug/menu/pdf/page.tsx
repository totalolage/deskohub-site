import { NotFound } from "@mcrovero/effect-nextjs/Navigation";
import { Effect } from "effect";
import { baseLocale } from "@/features/i18n";
import { MenuPdfDebugView } from "@/features/menu/components/menu-debug";
import { MenuService } from "@/features/menu/utils/generate-menu-pdf-document";
import { BasePage } from "@/shared/pages/base";

export default BasePage.build(
  Effect.fn("MenuPdfDebugPage")(
    function* MenuPage() {
      const menuService = yield* MenuService;

      const { categories, products } = yield* menuService.getMenuProps();

      return (
        <MenuPdfDebugView
          locale={baseLocale}
          categories={categories}
          products={products}
        />
      );
    },
    (effect) =>
      effect.pipe(
        Effect.annotateLogs({
          page: "MenuPdfDebugPage",
        }),
        Effect.provide(MenuService.Default),
        Effect.orElse(() => NotFound)
      )
  )
);
